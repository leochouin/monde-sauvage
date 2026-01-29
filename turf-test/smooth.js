// Load Turf
const turf = require('@turf/turf');
const fs = require('fs');

// Example: your original line (replace with your dataset coordinates)
const line = {
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-66.0, 48.0],
      [-65.8, 48.1],
      [-65.6, 48.0]
    ]
  }
};

// Smooth it
const curved = turf.bezierSpline(line, { sharpness: 0.85 });

// Save result to file
fs.writeFileSync("curved.json", JSON.stringify(curved, null, 2));

console.log("Smoothed line saved to curved.json");
