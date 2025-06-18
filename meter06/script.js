// Web audio visualizer with stereo frequency spectrum (6 bands per channel)
const AudioCtx = window.AudioContext || window.webkitAudioContext;

let audioContext, canvasContext;
let analyser, analyserLeft, analyserRight;
let bufferLength, bufferLengthLeft, bufferLengthRight;
let dataArray, dataArrayLeft, dataArrayRight;
let width, height, canvas, gradient;
let stereoPanner, splitter;

// Configuration
const FREQUENCY_BANDS = 6;
const BAR_GAP = 1; // pixels between bars
const PEAK_DECAY = 0.99; // decay rate per frame
const MIN_PEAK_LEVEL = 0;

// Peak tracking arrays
let peakLevelsLeft = new Array(FREQUENCY_BANDS).fill(0);
let peakLevelsRight = new Array(FREQUENCY_BANDS).fill(0);

// Frequency band ranges (logarithmic distribution)
const FREQUENCY_RANGES = [
  { min: 0, max: 4 },     // Bass: ~20-250 Hz
  { min: 4, max: 8 },     // Low-mid: ~250-500 Hz  
  { min: 8, max: 16 },    // Mid: ~500-1kHz
  { min: 16, max: 32 },   // High-mid: ~1-2kHz
  { min: 32, max: 64 },   // Presence: ~2-4kHz
  { min: 64, max: 128 }   // Treble: ~4kHz+
];

window.onload = function () {
  const startBtn = document.getElementById('startBtn');
  startBtn.onclick = startPlayback;
};

function startPlayback() {
  const startBtn = document.getElementById('startBtn');
  startBtn.disabled = true;
  startBtn.style.display = 'none';

  audioContext = new AudioCtx();

  const mediaElement = document.getElementById('player');
  mediaElement.play().catch((e) => {
    console.warn('Playback failed:', e);
  });

  canvas = document.getElementById('myCanvas');
  width = canvas.width;
  height = canvas.height;
  canvasContext = canvas.getContext('2d');

  gradient = canvasContext.createLinearGradient(width, 0, 0, 0);
  gradient.addColorStop(0, '#000000');
  gradient.addColorStop(0.25, '#ff0000');
  gradient.addColorStop(0.75, '#ffff00');
  gradient.addColorStop(1, '#ffffff');

  buildAudioGraph();
  requestAnimationFrame(visualize);
}

function buildAudioGraph() {
  const mediaElement = document.getElementById('player');
  const sourceNode = audioContext.createMediaElementSource(mediaElement);

  stereoPanner = audioContext.createStereoPanner();
  sourceNode.connect(stereoPanner);

  // Main analyser for waveform (keeping original functionality)
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  stereoPanner.connect(analyser);
  analyser.connect(audioContext.destination);

  // Left and right channel analysers for frequency spectrum
  analyserLeft = audioContext.createAnalyser();
  analyserLeft.fftSize = 512; // 256 frequency bins
  bufferLengthLeft = analyserLeft.frequencyBinCount;
  dataArrayLeft = new Uint8Array(bufferLengthLeft);

  analyserRight = audioContext.createAnalyser();
  analyserRight.fftSize = 512; // 256 frequency bins
  bufferLengthRight = analyserRight.frequencyBinCount;
  dataArrayRight = new Uint8Array(bufferLengthRight);

  splitter = audioContext.createChannelSplitter();
  stereoPanner.connect(splitter);
  splitter.connect(analyserLeft, 0);
  splitter.connect(analyserRight, 1);
}

function visualize() {
  clearCanvas();
  drawFrequencySpectrum();
  drawWaveform();
  requestAnimationFrame(visualize);
}

function clearCanvas() {
  canvasContext.clearRect(0, 0, width, height);
}

function drawWaveform() {
  canvasContext.save();
  analyser.getByteTimeDomainData(dataArray);

  canvasContext.lineWidth = 1;
  canvasContext.strokeStyle = "#1d1d1d";
  canvasContext.beginPath();

  const sliceWidth = width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 255;
    const y = v * height;
    i === 0 ? canvasContext.moveTo(x, y) : canvasContext.lineTo(x, y);
    x += sliceWidth;
  }

  canvasContext.lineTo(canvas.width, canvas.height / 2);
  canvasContext.stroke();
  canvasContext.restore();
}

function drawFrequencySpectrum() {
  canvasContext.save();

  // Get frequency data for both channels
  analyserLeft.getByteFrequencyData(dataArrayLeft);
  analyserRight.getByteFrequencyData(dataArrayRight);

  // Calculate frequency band levels
  const leftBandLevels = calculateFrequencyBandLevels(dataArrayLeft);
  const rightBandLevels = calculateFrequencyBandLevels(dataArrayRight);

  // Calculate bar dimensions
  const totalGaps = (FREQUENCY_BANDS * 2 - 1) * BAR_GAP; // gaps between all bars
  const availableHeight = height - totalGaps;
  const barHeight = availableHeight / (FREQUENCY_BANDS * 2);

  // Draw right channel bars (top section) - REVERSED ORDER (Treble to Bass)
  for (let i = 0; i < FREQUENCY_BANDS; i++) {
    const y = i * (barHeight + BAR_GAP);
    const reversedIndex = FREQUENCY_BANDS - 1 - i; // Reverse the frequency band index
    const level = rightBandLevels[reversedIndex];
    const scaledWidth = enhanceScaling(level, width);
    
    drawSegmentBarHorizontal(width, y, scaledWidth, barHeight, 8, 2, gradient);
    
    // Update and draw peak indicator
    peakLevelsRight[reversedIndex] = Math.max(peakLevelsRight[reversedIndex] * PEAK_DECAY, level, MIN_PEAK_LEVEL);
    const peakWidth = enhanceScaling(peakLevelsRight[reversedIndex], width);
    drawPeakIndicator(width, y, peakWidth, barHeight);
  }

  // Draw left channel bars (bottom section)
  const leftSectionStart = FREQUENCY_BANDS * (barHeight + BAR_GAP);
  for (let i = 0; i < FREQUENCY_BANDS; i++) {
    const y = leftSectionStart + i * (barHeight + BAR_GAP);
    const level = leftBandLevels[i];
    const scaledWidth = enhanceScaling(level, width);
    
    drawSegmentBarHorizontal(width, y, scaledWidth, barHeight, 8, 2, gradient);
    
    // Update and draw peak indicator
    peakLevelsLeft[i] = Math.max(peakLevelsLeft[i] * PEAK_DECAY, level, MIN_PEAK_LEVEL);
    const peakWidth = enhanceScaling(peakLevelsLeft[i], width);
    drawPeakIndicator(width, y, peakWidth, barHeight);
  }

  canvasContext.restore();
}

function calculateFrequencyBandLevels(frequencyData) {
  const bandLevels = [];
  
  for (let i = 0; i < FREQUENCY_BANDS; i++) {
    const range = FREQUENCY_RANGES[i];
    let sum = 0;
    let count = 0;
    
    // Average the frequency bins in this range
    for (let bin = range.min; bin < Math.min(range.max, frequencyData.length); bin++) {
      sum += frequencyData[bin];
      count++;
    }
    
    const average = count > 0 ? sum / count : 0;
    bandLevels.push(average);
  }
  
  return bandLevels;
}

function enhanceScaling(level, maxWidth) {
  const normalized = level / 255;
  // Increased scaling by 30% (0.5 -> 0.65)
  return (Math.pow(normalized, 0.6) + Math.sqrt(normalized) * 0.4) * maxWidth * 0.65;
}

function drawSegmentBarHorizontal(xRight, y, valueWidth, barHeight, segmentWidth, gap = 2, color = gradient) {
  if (valueWidth <= 0 || isNaN(valueWidth)) return;
  
  const totalSegmentWidth = segmentWidth + gap;
  const segmentCount = Math.floor(valueWidth / totalSegmentWidth);
  
  for (let i = 0; i < segmentCount && i < 50; i++) {
    const x = xRight - (i + 1) * totalSegmentWidth;
    if (x < 0) break;
    
    canvasContext.fillStyle = color;
    canvasContext.fillRect(x, y, segmentWidth, barHeight);
  }
}

function drawPeakIndicator(xRight, y, peakWidth, barHeight) {
  if (peakWidth <= 0 || isNaN(peakWidth)) return;
  
  const peakX = Math.max(0, xRight - peakWidth - 2);
  
  if (peakX >= 0 && peakX <= width - 2) {
    canvasContext.fillStyle = '#2ecc71';
    canvasContext.fillRect(peakX, y, 2, barHeight);
  }
}

function changeBalance(value) {
  const pan = parseFloat(value);
  stereoPanner.pan.value = pan;
  document.getElementById('balanceOutput').value = pan;
}
