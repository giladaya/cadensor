'use strict';

var FFT = require('./fft.js');

module.exports = function cadenceSensor(options){
  var NUM_SAMPLES = 64; //number of samples to consider
  var calibrationThreshold = 0.5; //amplitude threshold to perform calibration

  var options = {
    algorithm: 'zero-cross', //which algorithm to use
    axis: 'y',
    sample_rate: 10,   //10Hz sample rate
    max_freq: 5,       //max frequency (low pass filter)
    amp_thresh: 2,     //samples amplitude threshold (we want to see some motion)
    smooth_alpha: 0.1, //alpha value for low-pass smoothing

    multiplier: 1.0,   //multiplier for calculated cadence
  }

  //utility vars
  var interval; //sampling interval
  var samples = []; 
  var timestamp = 0;

  var fft = null;

  var stepTs = 0;    //last time we detected a tstep (cross-zero)
  var lastStrideDuration = Infinity; //used for zero-cross
  var zeroVal = 0; //used for calibration (zero value for measured axis)

  var lastSpm = 0;   //last calculated strides per minute value




  init(options);

  return {
    setOptions: setOptions,
    getValue: getValue
  };


  //-----------------------
  // Functions


  function init(options) {
    setOptions(options);

    interval = 1000 / options.sample_rate;

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
    if ((now - timestamp) < interval) {
      return;
    }
    timestamp = now;


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

    var spm = Math.round(smooth(lastSpm, freq*60, options.smooth_alpha));
    lastSpm = spm;
  }

  //Get dominant frequency from samples using FFT
  function getFreqFft(samples){
    var amplitude = getAmplitude(samples, 10);
    if (amplitude < options.amp_thresh) {
      return 0;
    }

    fft.forward(samples);

    var max = -99999, 
        maxIdx = -1;
    for (var i = 1; i < fft.spectrum.length; i++ ) {
      var freq = i * options.sample_rate / NUM_SAMPLES;
      if (freq > options.max_freq) {
        break;
      }
      if (fft.spectrum[i] > max){
        max = fft.spectrum[i];
        maxIdx = i;
      }
    }

    return maxIdx * options.sample_rate / NUM_SAMPLES;
  }

  function getFreqCross(samples) {
    var now = Date.now();
    var oldVal = samples[samples.length-2] - zeroVal;
    var curVal = samples[samples.length-1] - zeroVal;

    if (oldVal > 0 && curVal <= 0) {
      var tmpStrideDuration = (now - stepTs - interval/2)/1000;
      var freq = 1.0 / tmpStrideDuration;

      if (freq < options.max_freq) {
        //there was a zero cross
        lastStrideDuration = tmpStrideDuration;
        stepTs = now;
      } else {
        //there was a zero cross but too soon
      }
    } else {
      //there was no cross
    }

    var amplitude = getAmplitude(samples, 10);
    if (amplitude < options.amp_thresh) {
      //we're probably motionless
      lastStrideDuration = Infinity;

      //good time to calibrate zero value
      if (amplitude < calibrationThreshold){
        zeroVal = getAverage(samples, 10);
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