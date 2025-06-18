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

  gradient = canvasContext.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(1, '#000000');
  gradient.addColorStop(0.75, '#ff0000');
  gradient.addColorStop(0.25, '#ffff00');
  gradient.addColorStop(0, '#ffffff');

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

// Helper to draw a segmented vertical bar
function drawSegmentBar(x, yBottom, barWidth, valueHeight, segmentHeight, gap = 2, color = gradient) {
  const segmentCount = Math.floor(valueHeight / (segmentHeight + gap));
  for (let i = 0; i < segmentCount; i++) {
    const y = yBottom - (i + 1) * (segmentHeight + gap);
    canvasContext.fillStyle = color;
    canvasContext.fillRect(x, y, barWidth, segmentHeight);
  }
}

function drawVolumeMeters() {
  canvasContext.save();

  analyserLeft.getByteFrequencyData(dataArrayLeft);
  let averageLeft = getAverageVolume(dataArrayLeft);
  let scaledLeft = Math.min(height, averageLeft * 1.5);

  analyserRight.getByteFrequencyData(dataArrayRight);
  let averageRight = getAverageVolume(dataArrayRight);
  let scaledRight = Math.min(height, averageRight * 1.5);

  const gap = 4;
  const barWidth = (width - gap) / 2;
  const segmentHeight = 6;

  // Draw segmented bars
  drawSegmentBar(0, height, barWidth, scaledLeft, segmentHeight, 2, gradient);
  drawSegmentBar(barWidth + gap, height, barWidth, scaledRight, segmentHeight, 2, gradient);

  // Update peak levels (decay toward min)
  peakLevelLeft = Math.max(peakLevelLeft * peakDecay, averageLeft, minPeakLevel);
  peakLevelRight = Math.max(peakLevelRight * peakDecay, averageRight, minPeakLevel);

  // Convert to canvas heights
  const peakHeightLeft = Math.min(height, peakLevelLeft * 1.5);
  const peakHeightRight = Math.min(height, peakLevelRight * 1.5);

  // Draw floating peak indicators
  canvasContext.fillStyle = '#2ecc71';
  canvasContext.fillRect(0, height - peakHeightLeft - 2, barWidth, 2);
  canvasContext.fillRect(barWidth + gap, height - peakHeightRight - 2, barWidth, 2);

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
