// ==============================================================================
// 🌍 STEP 1: INITIALIZATION & URBAN MASKING
// ==============================================================================
var cities = {
  'Pune & PCMC': ee.Geometry.Rectangle([73.60, 18.40, 74.00, 18.75]),
  'Delhi (NCR)': ee.Geometry.Rectangle([76.83, 28.40, 77.34, 28.88]),
  'Mumbai': ee.Geometry.Rectangle([72.77, 18.89, 73.10, 19.27]),
  'Bengaluru': ee.Geometry.Rectangle([77.46, 12.83, 77.74, 13.14]),
  'Chennai': ee.Geometry.Rectangle([80.12, 12.92, 80.33, 13.14]),
  'Kolkata': ee.Geometry.Rectangle([88.25, 22.45, 88.45, 22.65])
};

var worldCover = ee.ImageCollection("ESA/WorldCover/v100").first();
var urbanMask = worldCover.eq(50); 

var no2Vis = {min: 0, max: 0.00008, palette: ['black', 'blue', 'purple', 'cyan', 'green', 'yellow', 'red']};
var aerVis = {min: -1.0, max: 2.0, palette: ['black', 'blue', 'purple', 'cyan', 'green', 'yellow', 'red']};
var diffVis = {min: -0.00002, max: 0.00002, palette: ['blue', 'white', 'red']}; 

// ==============================================================================
// 🛠️ STEP 2: BUILD THE MAPS
// ==============================================================================
var leftMap = ui.Map(); leftMap.setControlVisibility({all: false, zoomControl: true});
var rightMap = ui.Map(); rightMap.setControlVisibility({all: false, zoomControl: true});

var leftLabel = ui.Label('Period 1', {position: 'bottom-left', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.8)'});
var rightLabel = ui.Label('Period 2', {position: 'bottom-right', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.8)'});
leftMap.add(leftLabel); rightMap.add(rightLabel);

var linkedMaps = ui.Map.Linker([leftMap, rightMap]);
var splitMap = ui.SplitPanel({firstPanel: linkedMaps.get(0), secondPanel: linkedMaps.get(1), orientation: 'horizontal', wipe: true, style: {stretch: 'both'}});

// ==============================================================================
// 📊 STEP 3: BUILD THE UI DASHBOARD
// ==============================================================================
var sidePanel = ui.Panel({style: {width: '420px', padding: '15px', backgroundColor: '#f8f9fa'}});

var title = ui.Label('Urban Emissions Analytics', {fontSize: '22px', fontWeight: 'bold', margin: '0 0 10px 0'});
var description = ui.Label('Translating satellite observations into actionable urban policy. Data is strictly masked to ESA urban boundaries.', {color: '#555', margin: '0 0 15px 0', fontSize: '12px'});

var citySelect = ui.Select({items: Object.keys(cities), value: 'Pune & PCMC', style: {width: '100%'}});
var selectMenu = ui.Select({items: ['Tropospheric NO2', 'Aerosol Index (UVAI)', 'Absolute Difference (NO2)'], value: 'Tropospheric NO2', style: {width: '100%'}});

var dateStyle = {width: '150px', margin: '2px 10px'};
var p1Start = ui.Textbox({value: '2020-03-25', style: dateStyle}); var p1End = ui.Textbox({value: '2020-05-31', style: dateStyle});
var p2Start = ui.Textbox({value: '2026-01-01', style: dateStyle}); var p2End = ui.Textbox({value: '2026-02-28', style: dateStyle});

var p1Panel = ui.Panel([ui.Label('Baseline (YYYY-MM-DD):', {fontWeight: 'bold'}), ui.Panel([p1Start, p1End], ui.Panel.Layout.Flow('horizontal'))]);
var p2Panel = ui.Panel([ui.Label('Observation (YYYY-MM-DD):', {fontWeight: 'bold'}), ui.Panel([p2Start, p2End], ui.Panel.Layout.Flow('horizontal'))]);

var updateBtn = ui.Button({label: '🔄 Process Satellite Data', style: {stretch: 'horizontal', margin: '15px 0', color: 'darkblue'}});
var opacitySlider = ui.Slider({min: 0, max: 1, value: 0.8, step: 0.05, style: {stretch: 'horizontal'}});
var legendPanel = ui.Panel({style: {margin: '15px 0'}});
var chartPanel = ui.Panel({style: {margin: '15px 0'}});

sidePanel.add(title).add(description).add(ui.Label('1. Target Region:', {fontWeight: 'bold'})).add(citySelect)
  .add(ui.Label('2. Parameter:', {fontWeight: 'bold', margin: '10px 0 5px 0'})).add(selectMenu)
  .add(ui.Label('3. Temporal Bounds:', {fontWeight: 'bold', margin: '15px 0 5px 0'})).add(p1Panel).add(p2Panel).add(updateBtn)
  .add(ui.Label('4. Visual Opacity:', {fontWeight: 'bold'})).add(opacitySlider).add(legendPanel).add(chartPanel);

// ==============================================================================
// ⚙️ STEP 4: STRICT SCIENTIFIC LOGIC & QA
// ==============================================================================
function updateOpacity() {
  var op = opacitySlider.getValue();
  leftMap.layers().forEach(function(layer) { layer.setOpacity(op); });
  rightMap.layers().forEach(function(layer) { layer.setOpacity(op); });
}

function maskS5P_NO2(image) { 
  var cloudFraction = image.select('cloud_fraction');
  return image.updateMask(cloudFraction.lt(0.3)); 
}

function buildLegend(visParams, titleText) {
  legendPanel.clear();
  var makeColorBarParams = function(palette) { return {bbox: [0, 0, 1, 0.1], dimensions: '100x10', format: 'png', min: 0, max: 1, palette: palette}; };
  var colorBar = ui.Thumbnail({image: ee.Image.pixelLonLat().select(0), params: makeColorBarParams(visParams.palette), style: {stretch: 'horizontal', margin: '0px 8px', maxHeight: '24px'}});
  var legendLabels = ui.Panel({
    widgets: [ui.Label(visParams.min, {margin: '4px 8px'}), ui.Label(titleText, {margin: '4px 8px', textAlign: 'center', stretch: 'horizontal', fontSize: '10px'}), ui.Label(visParams.max, {margin: '4px 8px'})],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  legendPanel.add(ui.Label('Scale:', {fontWeight: 'bold'})).add(colorBar).add(legendLabels);
}

function updateApp() {
  updateBtn.setLabel('⏳ Computing Analytics...'); 
  updateBtn.setDisabled(true);
  
  var currentRoi = cities[citySelect.getValue()];
  leftMap.centerObject(currentRoi, 11);
  
  var choice = selectMenu.getValue();
  // 🚨 BUG FIX: Using indexOf instead of includes for GEE's older JS engine
  var isNO2 = choice.indexOf('NO2') > -1; 
  
  var d1S = p1Start.getValue(); var d1E = p1End.getValue();
  var d2S = p2Start.getValue(); var d2E = p2End.getValue();
  
  leftLabel.setValue('Baseline: ' + d1S + ' to ' + d1E); rightLabel.setValue('Observation: ' + d2S + ' to ' + d2E);
  leftMap.layers().reset(); rightMap.layers().reset(); chartPanel.clear();
  
  var collection, vis, yTitle, isDiff = false;
  var bandName = (choice === 'Tropospheric NO2' || choice === 'Absolute Difference (NO2)') 
               ? 'tropospheric_NO2_column_number_density' 
               : 'absorbing_aerosol_index';

  if (choice === 'Tropospheric NO2') {
    collection = ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_NO2').map(maskS5P_NO2);
    vis = no2Vis; yTitle = 'Density (μmol/m²)';
  } else if (choice === 'Aerosol Index (UVAI)') {
    collection = ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_AER_AI'); 
    vis = aerVis; yTitle = 'Aerosol Index';
  } else {
    collection = ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_NO2').map(maskS5P_NO2);
    vis = diffVis; yTitle = 'Absolute Anomaly'; isDiff = true;
  }

  var c1 = collection.filterBounds(currentRoi).filterDate(d1S, d1E);
  var c2 = collection.filterBounds(currentRoi).filterDate(d2S, d2E);

  var img1 = c1.mean().updateMask(urbanMask).clip(currentRoi);
  var img2 = c2.mean().updateMask(urbanMask).clip(currentRoi);

  if (isDiff) {
    var diffImg = img2.subtract(img1);
    leftMap.addLayer(img1.select(bandName), no2Vis, 'Baseline', true, opacitySlider.getValue()); 
    rightMap.addLayer(diffImg.select(bandName), vis, 'Anomaly', true, opacitySlider.getValue());
  } else {
    leftMap.addLayer(img1.select(bandName), vis, 'Baseline', true, opacitySlider.getValue());
    rightMap.addLayer(img2.select(bandName), vis, 'Observation', true, opacitySlider.getValue());
  }
  buildLegend(vis, choice); 
  
  var combinedReducer = ee.Reducer.mean().combine({reducer2: ee.Reducer.stdDev(), sharedInputs: true});
  
  var stats1 = ee.Algorithms.If(c1.size().gt(0), img1.select(bandName).reduceRegion({reducer: combinedReducer, geometry: currentRoi, scale: 1000, maxPixels: 1e9}), ee.Dictionary({}));
  var stats2 = ee.Algorithms.If(c2.size().gt(0), img2.select(bandName).reduceRegion({reducer: combinedReducer, geometry: currentRoi, scale: 1000, maxPixels: 1e9}), ee.Dictionary({}));

  ee.Dictionary({
    m1: ee.Dictionary(stats1).get(bandName + '_mean'), sd1: ee.Dictionary(stats1).get(bandName + '_stdDev'),
    m2: ee.Dictionary(stats2).get(bandName + '_mean'), sd2: ee.Dictionary(stats2).get(bandName + '_stdDev'),
    count1: c1.size(), count2: c2.size()
  }).evaluate(function(res, err) {
    
    updateBtn.setLabel('🔄 Process Satellite Data'); 
    updateBtn.setDisabled(false);

    if (err) { chartPanel.add(ui.Label('⚠️ Error: ' + err, {color: 'red'})); return; }
    if (res.count1 === 0 || res.count2 === 0) {
      chartPanel.add(ui.Label('⚠️ No Data Found. Adjust dates.', {color: '#de2d26', fontWeight: 'bold'})); return;
    }
    if (res.m1 == null || res.m2 == null) {
      chartPanel.add(ui.Label('⚠️ Insufficient Valid Pixels due to cloud cover.', {color: '#de2d26', fontWeight: 'bold'})); return;
    }
    
    // 📊 THE UX TRANSLATION ENGINE
    // Multiply NO2 by 1,000,000 to convert to Micromoles for readable whole numbers
    var multiplier = isNO2 ? 1000000 : 1; 
    var unitStr = isNO2 ? ' μmol/m²' : ' Index';
    
    var baseVal = (res.m1 * multiplier).toFixed(1);
    var baseDev = (res.sd1 * multiplier).toFixed(1);
    var obsVal = (res.m2 * multiplier).toFixed(1);
    var obsDev = (res.sd2 * multiplier).toFixed(1);

    var relChange = ((res.m2 - res.m1) / Math.abs(res.m1)) * 100;
    
    // Policy Framing Logic
    var trendTitle, trendColor, insightText;
    if (relChange > 20) {
      trendTitle = 'CRITICAL SURGE ⚠️ (+' + relChange.toFixed(1) + '%)';
      trendColor = '#de2d26'; // Dark Red
      insightText = 'Insight: Severe degradation of air quality. Emissions have significantly expanded across the urban footprint.';
    } else if (relChange > 5) {
      trendTitle = 'ELEVATED ⚠️ (+' + relChange.toFixed(1) + '%)';
      trendColor = '#fb6a4a'; // Light Red
      insightText = 'Insight: Moderate increase in localized urban emissions.';
    } else if (relChange < -5) {
      trendTitle = 'IMPROVEMENT 🍃 (' + relChange.toFixed(1) + '%)';
      trendColor = '#2ca25f'; // Green
      insightText = 'Insight: Measurable reduction in regional atmospheric pollutants.';
    } else {
      trendTitle = 'STAGNANT ➖ (' + relChange.toFixed(1) + '%)';
      trendColor = '#888888'; // Gray
      insightText = 'Insight: No significant change in urban emission levels between these periods.';
    }

    // Build the non-technical UI Panel
    var summaryBox = ui.Panel({
      widgets: [
        ui.Label('Urban Impact Summary', {fontWeight: 'bold', fontSize: '14px', color: '#333'}),
        ui.Label(trendTitle, {fontWeight: 'bold', fontSize: '18px', color: trendColor, margin: '4px 0 12px 0'}),
        
        ui.Label('Period 1 Average:  ' + baseVal + ' (±' + baseDev + ')' + unitStr, {fontSize: '13px', color: '#444'}),
        ui.Label('Period 2 Average:  ' + obsVal + ' (±' + obsDev + ')' + unitStr, {fontSize: '13px', color: '#444', margin: '0 0 10px 0'}),
        
        ui.Label(insightText, {fontSize: '12px', color: trendColor, fontWeight: 'bold'})
      ],
      style: {border: '2px solid ' + trendColor, padding: '12px', backgroundColor: '#ffffff', margin: '10px 0'}
    });
    
    chartPanel.add(summaryBox);

    var combinedImage = ee.Image([img1.select(bandName).rename('Baseline'), img2.select(bandName).rename('Observation')]);
    var histogramChart = ui.Chart.image.histogram({
      image: combinedImage, region: currentRoi, scale: 1000, maxPixels: 1e9,
      minBucketWidth: isNO2 ? 0.000005 : 0.1 
    }).setOptions({
      title: 'Pollutant Geographic Spread', fontSize: 11, colors: ['#2ca25f', '#de2d26'],
      hAxis: {title: 'Intensity', titleTextStyle: {italic: false, bold: true}},
      vAxis: {title: 'Neighborhoods Affected (Pixel Count)', titleTextStyle: {italic: false, bold: true}},
      interpolateNulls: true, legend: {position: 'top'}
    });

    chartPanel.add(histogramChart);
  });
}

opacitySlider.onChange(updateOpacity); updateBtn.onClick(updateApp);          
ui.root.clear(); ui.root.add(sidePanel); ui.root.add(splitMap); updateApp();