// Web audio visualizer with stereo panning and waveform
const AudioCtx = window.AudioContext || window.webkitAudioContext;

let audioContext, canvasContext;
let analyser, analyserLeft, analyserRight;
let bufferLength, bufferLengthLeft, bufferLengthRight;
let dataArray, dataArrayLeft, dataArrayRight;
let width, height, canvas, gradient;
let stereoPanner, splitter;

let peakLevelLeft = 5;
let peakLevelRight = 5;
const peakDecay = 0.99; // decay rate per frame
const minPeakLevel = 2;

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

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  stereoPanner.connect(analyser);
  analyser.connect(audioContext.destination);

  analyserLeft = audioContext.createAnalyser();
  analyserLeft.fftSize = 256;
  bufferLengthLeft = analyserLeft.frequencyBinCount;
  dataArrayLeft = new Uint8Array(bufferLengthLeft);

  analyserRight = audioContext.createAnalyser();
  analyserRight.fftSize = 256;
  bufferLengthRight = analyserRight.frequencyBinCount;
  dataArrayRight = new Uint8Array(bufferLengthRight);

  splitter = audioContext.createChannelSplitter();
  stereoPanner.connect(splitter);
  splitter.connect(analyserLeft, 0);
  splitter.connect(analyserRight, 1);
}

function visualize() {
  clearCanvas();
  drawVolumeMeters();
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

// Helper to draw a segmented horizontal bar (from right to left)
function drawSegmentBarHorizontal(xRight, y, valueWidth, barHeight, segmentWidth, gap = 2, color = gradient) {
  if (valueWidth <= 0 || isNaN(valueWidth)) return;
  
  const totalSegmentWidth = segmentWidth + gap;
  const segmentCount = Math.floor(valueWidth / totalSegmentWidth);
  
  for (let i = 0; i < segmentCount && i < 50; i++) { // Limit to 50 segments max
    const x = xRight - (i + 1) * totalSegmentWidth;
    if (x < 0) break;
    
    canvasContext.fillStyle = color;
    canvasContext.fillRect(x, y, segmentWidth, barHeight);
  }
}

function drawVolumeMeters() {
  canvasContext.save();

  analyserLeft.getByteFrequencyData(dataArrayLeft);
  let averageLeft = getAverageVolume(dataArrayLeft);
  let scaledLeft = (averageLeft / 128) * width * 0.5; // Simple scaling

  analyserRight.getByteFrequencyData(dataArrayRight);
  let averageRight = getAverageVolume(dataArrayRight);
  let scaledRight = (averageRight / 128) * width * 0.5; // Simple scaling

  const gap = 4;
  const barHeight = (height - gap) / 2;
  const segmentWidth = 8;

  // Draw segmented bars (horizontal from right to left)
  drawSegmentBarHorizontal(width, 0, scaledLeft, barHeight, segmentWidth, 2, gradient);
  drawSegmentBarHorizontal(width, barHeight + gap, scaledRight, barHeight, segmentWidth, 2, gradient);

  // Update peak levels
  peakLevelLeft = Math.max(peakLevelLeft * peakDecay, averageLeft, minPeakLevel);
  peakLevelRight = Math.max(peakLevelRight * peakDecay, averageRight, minPeakLevel);

  // Convert to canvas widths
  const peakWidthLeft = (peakLevelLeft / 128) * width * 0.5;
  const peakWidthRight = (peakLevelRight / 128) * width * 0.5;

  // Draw floating peak indicators
  canvasContext.fillStyle = '#2ecc71';
  const peakX1 = width - peakWidthLeft - 2;
  const peakX2 = width - peakWidthRight - 2;
  
  if (peakX1 > 0 && peakX1 < width) {
    canvasContext.fillRect(peakX1, 0, 2, barHeight);
  }
  if (peakX2 > 0 && peakX2 < width) {
    canvasContext.fillRect(peakX2, barHeight + gap, 2, barHeight);
  }

  canvasContext.restore();
}

function getAverageVolume(array) {
  const total = array.reduce((sum, value) => sum + value, 0);
  return total / array.length;
}

function changeBalance(value) {
  const pan = parseFloat(value);
  stereoPanner.pan.value = pan;
  document.getElementById('balanceOutput').value = pan;
}
