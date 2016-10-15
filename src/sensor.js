'use strict';

var FFT = require('./fft.js');

module.exports = function cadenceSensor(config){
  var NUM_SAMPLES = 128; //number of samples to consider
  var calibrationThreshold = 0.5; //amplitude threshold to perform calibration

  var options = {
    algorithm: 'zero-cross', //which algorithm to use (zero-cross or fft)
    axis: 'y',
    max_stride_freq: 5,      //max stride frequency (low pass filter)
    acc_amp_thresh: 2,       //samples acceleration amplitude threshold (we want to see some motion)
    smooth_alpha: 0.1,       //alpha value for low-pass smoothing
    smooth_alpha_rising: 0.7,       //alpha value for smoothing when SPM value is getting higher
    smooth_alpha_falling: 0.1,      //alpha value for smoothing when SPM value is getting lower
    fft_mag_threshold: 1.0,  //fft result magnitude reliability threshold (ignore below this)

    multiplier: 1.0,         //multiplier for calculated cadence
  }

  //utility vars
  var sampleIntervalMS; //sampling interval in milli seconds
  var samples = []; 
  var lastSampleTimestamp = -1;
  var rawSampleRate = null;  //sample rate we get from device
  var sampleRateSamples = 3; //number of samples used to calculate sample rate
  var samplesToSkip = 0;
  var samplesSkipped = 0;
  var actualSampleRate = null;  //sample rate we take
  var amplitudeCheckSamples = 10;

  //for fft algorithm
  var fft = null; //fft object

  //for zero-cross algorithm
  var stepTs = 0;    //last time we detected a step (cross-zero)
  var lastStrideDuration = Infinity;
  var zeroVal = 0;   //used for calibration (zero value for measured axis)

  var lastSpm = 0;   //last calculated strides per minute value




  init(config);

  return {
    setOptions: setOptions,
    getValue: getValue
  };


  //-----------------------
  // Functions


  function init(options) {
    setOptions(options);

    fft = new FFT(NUM_SAMPLES, options.sample_rate);
    samples = getInitArr(NUM_SAMPLES);

    window.addEventListener("devicemotion", doSample, false);
  }


  function setOptions(config) {
    options = Object.assign(options, config);
  }

  function getValue() {
    return lastSpm * options.multiplier;
  }


  //get Float32Array of length initialized to 0
  function getInitArr(length) {
    var arr = new Float32Array(length);
    for (var i = 0; i < length; i++) {
      arr[i] = 0;
    }
    return arr;
  }

  //add a sample to the end of the array
  //in place
  //returns the first value from the array
  function shift(arr, datum) {
    var ret = arr[0];
    for (var i = 1; i < arr.length; i++) {
      arr[i-1] = arr[i];
    }
    arr[arr.length - 1] = datum;
    return ret;
  }

  //Get a smoothed value (simple low-pass filter)
  function smooth(oldVal, newVal, alpha){
    return alpha * oldVal + (1-alpha) * newVal;
  }

  function doSample(event) {
    var now = Date.now();
    if (lastSampleTimestamp <= 0){
      lastSampleTimestamp = now;
      return;  
    }
    var deltaSec = (now - lastSampleTimestamp)/1000;


    if (sampleRateSamples > 0){
      if (rawSampleRate == null) {
        rawSampleRate = 1 / deltaSec;
      } else {
        rawSampleRate = (rawSampleRate + (1 / deltaSec))/2; //Hz
        sampleIntervalMS = 1000 / rawSampleRate;

        var destSampleRate = 2*options.max_stride_freq;
        samplesToSkip = Math.floor(rawSampleRate / destSampleRate) - 1;
        sampleIntervalMS *= (samplesToSkip+1);
        actualSampleRate = 1000/sampleIntervalMS; //Hz
        amplitudeCheckSamples = Math.ceil(actualSampleRate); //look a second back
      }
      sampleRateSamples--;
    } else {
      if (samplesSkipped < samplesToSkip) {
        samplesSkipped++;
        return;
      }
      samplesSkipped = 0;

      var datum = event.accelerationIncludingGravity[options.axis] || 0.5;

      var smoothed = smooth(samples[samples.length-1], datum, options.smooth_alpha);
      shift(samples, smoothed);

      var freq = -1;
      switch (options.algorithm) {
        case 'fft':
          freq = getFreqFft(samples);
          break;
        case 'zero-cross':
          freq = getFreqCross(samples);
          break;
      }

      var spm = Math.round(freq*60);
      if (spm > lastSpm) {
        //rising
        spm = Math.round(smooth(lastSpm, spm, options.smooth_alpha_rising));
      } else {
        //falling
        spm = Math.round(smooth(lastSpm, spm, options.smooth_alpha_falling));
      }
      lastSpm = spm;
    }
    
    lastSampleTimestamp = now;
  }

  //Get dominant frequency from samples using FFT
  function getFreqFft(samples){
    var amplitude = getAmplitude(samples, amplitudeCheckSamples);
    if (amplitude < options.acc_amp_thresh) {
      return 0;
    }

    fft.forward(samples);

    var max = -99999, 
        maxIdx = -1;
    for (var i = 1; i < fft.spectrum.length; i++ ) {
      var freq = i * actualSampleRate / NUM_SAMPLES;
      if (freq > options.max_stride_freq) {
        break;
      }
      if (fft.spectrum[i] > max){
        max = fft.spectrum[i];
        maxIdx = i;
      }
    }

    if (max < options.fft_mag_threshold) {
      return 0;
    }
    return maxIdx * actualSampleRate / NUM_SAMPLES;
  }

  function getFreqCross(samples) {
    var now = Date.now();
    var oldVal = samples[samples.length-2] - zeroVal;
    var curVal = samples[samples.length-1] - zeroVal;

    // if (oldVal > 0 && curVal <= 0) {
    if (samples[samples.length-4] > zeroVal && samples[samples.length-3] > zeroVal && 
        samples[samples.length-2] <= zeroVal && samples[samples.length-1] <= zeroVal) {
      var tmpStrideDuration = (now - stepTs - sampleIntervalMS/2)/1000;
      var freq = 1.0 / tmpStrideDuration;

      if (freq < options.max_stride_freq) {
        //there was a zero cross
        lastStrideDuration = tmpStrideDuration;
        stepTs = now;
      } else {
        //there was a zero cross but too soon
      }
    } else {
      //there was no cross
    }

    var amplitude = getAmplitude(samples, amplitudeCheckSamples);
    if (amplitude < options.acc_amp_thresh) {
      //we're probably motionless
      lastStrideDuration = Infinity;

      //good time to calibrate zero value
      if (amplitude < calibrationThreshold){
        zeroVal = getAverage(samples, 32);
      }

      return 0;
    } else {

      return 1/lastStrideDuration;
    }
  }

  //get amplitude from last count samples
  function getAmplitude(samples, count) {
    count = count || (samples.length - 1);
    var min = 99999,
        max = -99999;

    for (var i = samples.length - 1; i >= samples.length - 1 - count; i--) {
      if (samples[i] < min) {
        min = samples[i];
      }
      if (samples[i] > max) {
        max = samples[i];
      }
    }
    return max - min;
  }

  function getAverage(samples, count) {
    count = count || (samples.length - 1);
    var sum = 0;

    for (var i = samples.length - 1; i >= samples.length - 1 - count; i--) {
      sum += samples[i];
    }

    return sum/count;
  }
}