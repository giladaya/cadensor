# Cadensor
Cadence sensor for mobile devices using motion events.  

Inplements two and a half algorithms for detecting repeating motion frequency:  
1. FFT  
2. Zero-Cross  
2.1 Acceleration based  
2.2 Velocity based

Velocity based measures worked best in the use casse this was developed for (VR)

## Build
`npm install`  
`npm run build`

## Use
See `src/sensor.js` code for available options.  
See `examples/simple.html` for usage

## Live Demo
[Try it](https://giladaya.github.io/cadensor/examples/controls.html) on a mobile device!