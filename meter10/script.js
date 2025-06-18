// Web audio visualizer with stereo frequency spectrum (6 bands per channel)
const AudioCtx = window.AudioContext || window.webkitAudioContext;

let audioContext, canvasContext;
let analyser, analyserLeft, analyserRight;
let bufferLength, bufferLengthLeft, bufferLengthRight;
let dataArray, dataArrayLeft, dataArrayRight;
let width, height, canvas, gradient;
let stereoPanner, splitter;


let barDirection = 'right-to-left';
// let barDirection = 'left-to-right';


// Configuration
const FREQUENCY_BANDS = 12;
const BAR_GAP = 0.5; // pixels between bars
const PEAK_DECAY = 0.99; // decay rate per frame
const MIN_PEAK_LEVEL = 0;

// Peak tracking arrays
let peakLevelsLeft = new Array(FREQUENCY_BANDS).fill(0);
let peakLevelsRight = new Array(FREQUENCY_BANDS).fill(0);

// Frequency band ranges (logarithmic distribution for 12 bands)
const FREQUENCY_RANGES = [
	{ min: 0, max: 2 },     // Sub-bass: ~20-150 Hz
	{ min: 2, max: 4 },     // Bass: ~150-250 Hz
	{ min: 4, max: 6 },     // Low bass: ~250-350 Hz
	{ min: 6, max: 9 },     // Low-mid: ~350-500 Hz
	{ min: 9, max: 13 },    // Mid-low: ~500-750 Hz
	{ min: 13, max: 18 },   // Mid: ~750-1kHz
	{ min: 18, max: 25 },   // Mid-high: ~1-1.4kHz
	{ min: 25, max: 35 },   // High-mid: ~1.4-2kHz
	{ min: 35, max: 50 },   // Presence: ~2-2.9kHz
	{ min: 50, max: 70 },   // Brilliance: ~2.9-4kHz
	{ min: 70, max: 100 },  // High treble: ~4-5.7kHz
	{ min: 100, max: 140 }  // Ultra-high: ~5.7-8kHz+
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
	canvasContext = canvas.getContext('2d');

	// Don't set width/height or create gradient here - let checkCanvasSize() handle it

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
	analyser.fftSize = 2048;
	bufferLength = analyser.frequencyBinCount;
	dataArray = new Uint8Array(bufferLength);

	stereoPanner.connect(analyser);
	analyser.connect(audioContext.destination);

	// Left and right channel analysers for frequency spectrum
	analyserLeft = audioContext.createAnalyser();
	analyserLeft.fftSize = 1024; // 512 frequency bins
	bufferLengthLeft = analyserLeft.frequencyBinCount;
	dataArrayLeft = new Uint8Array(bufferLengthLeft);

	analyserRight = audioContext.createAnalyser();
	analyserRight.fftSize = 1024; // 512 frequency bins
	bufferLengthRight = analyserRight.frequencyBinCount;
	dataArrayRight = new Uint8Array(bufferLengthRight);

	splitter = audioContext.createChannelSplitter();
	stereoPanner.connect(splitter);
	splitter.connect(analyserLeft, 0);
	splitter.connect(analyserRight, 1);
}

function visualize() {
	// Check if canvas needs resizing on every frame
	checkCanvasSize();

	clearCanvas();
	drawFrequencySpectrum();
	drawWaveform();
	requestAnimationFrame(visualize);
}

function checkCanvasSize() {
	const displayWidth = canvas.clientWidth;
	const displayHeight = canvas.clientHeight;

	// Only resize if dimensions have actually changed
	if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
		canvas.width = displayWidth;
		canvas.height = displayHeight;

		// Update our width and height variables
		width = canvas.width;
		height = canvas.height;

		gradient = (barDirection === 'right-to-left')
			? canvasContext.createLinearGradient(width, 0, 0, 0) // Red on the right
			: canvasContext.createLinearGradient(0, 0, width, 0); // Red on the left



		// Fixed gradient - more vibrant colors with better distribution
		gradient.addColorStop(1, '#111111');     // Near black (silent)
		gradient.addColorStop(0.85, '#0055ff');  // Strong blue (low activity)
		gradient.addColorStop(0.65, '#00ffff');  // Cyan (rising energy)
		gradient.addColorStop(0.45, '#00ff00');  // Green (mid energy)
		gradient.addColorStop(0.25, '#ffff00');  // Yellow (high energy)
		gradient.addColorStop(0.10, '#ff6600');  // Orange (very high)
		gradient.addColorStop(0, '#ff0000');     // Red (peak)

	}
}

function clearCanvas() {
	canvasContext.clearRect(0, 0, width, height);
}

function drawWaveform() {
	canvasContext.save();
	analyser.getByteTimeDomainData(dataArray);

	// Find the highest peak level across all frequency bands
	const maxPeakLeft = Math.max(...peakLevelsLeft);
	const maxPeakRight = Math.max(...peakLevelsRight);
	const highestPeak = Math.max(maxPeakLeft, maxPeakRight);

	// Don't draw waveform if no meaningful audio activity (peak levels at rest)
	if (highestPeak <= MIN_PEAK_LEVEL + 1) { // Small threshold for noise
		canvasContext.restore();
		return;
	}

	// Calculate where the highest peak indicator is positioned (from right edge)
	const peakWidth = enhanceScaling(highestPeak, width);
	const peakPosition = width - peakWidth; // X position of the peak indicator

	// Add extra distance so waveform extends beyond peak indicators
	const extraDistance = width * 0.1; // 10% of canvas width extra
	const extendedPosition = Math.max(0, peakPosition - extraDistance);

	// Set fade start position as a percentage - waveform extends beyond peaks
	const fadeStartPercent = Math.max(0.05, Math.min(0.95, extendedPosition / width));
	const fadeTransitionPercent = Math.min(0.98, fadeStartPercent + 0.05); // Very short transition zone

	// Create a gradient mask with color transition from gray to white (right side)
	let waveformGradient;
	if (barDirection === 'right-to-left') {
		waveformGradient = canvasContext.createLinearGradient(0, 0, width, 0);
		waveformGradient.addColorStop(0, '#1d1d1d00');                       // Left = transparent
		waveformGradient.addColorStop(fadeStartPercent, '#1d1d1d00');       // Start fade
		waveformGradient.addColorStop(fadeTransitionPercent, '#1d1d1d40');  // Transition
		waveformGradient.addColorStop(0.90, '#808080');                     // Mid-gray
		waveformGradient.addColorStop(1, '#ffffff');                        // Peak side = white
	} else {
		waveformGradient = canvasContext.createLinearGradient(width, 0, 0, 0);
		waveformGradient.addColorStop(0, '#1d1d1d00');                       // Right = transparent
		waveformGradient.addColorStop(fadeStartPercent, '#1d1d1d00');
		waveformGradient.addColorStop(fadeTransitionPercent, '#1d1d1d40');
		waveformGradient.addColorStop(0.90, '#808080');
		waveformGradient.addColorStop(1, '#ffffff');                        // Peak side = white
	}


	canvasContext.lineWidth = 1;
	canvasContext.strokeStyle = waveformGradient;
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

		// Pass frequency index for particle scaling (higher index = smaller particles)
		drawSegmentBarHorizontal(width, y, scaledWidth, barHeight, 8, 2, gradient, reversedIndex);

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

		// Pass frequency index for particle scaling (higher index = smaller particles)
		drawSegmentBarHorizontal(width, y, scaledWidth, barHeight, 8, 2, gradient, i);

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
	// Increased scaling by 20% (0.5 -> 0.6)
	return (Math.pow(normalized, 0.6) + Math.sqrt(normalized) * 0.4) * maxWidth * 0.6;
}

function drawSegmentBarHorizontal(xRight, y, valueWidth, barHeight, segmentWidth, gap = 2, color = gradient, frequencyIndex = 0) {
	if (valueWidth <= 0 || isNaN(valueWidth)) return;

	// Auto-adjust segment width to maintain square proportions based on bar height
	const baseSegmentWidth = Math.max(2, Math.floor(barHeight * 0.9)); // n% of bar height for slight gap
	const baseGap = Math.max(1, Math.floor(barHeight * 0.2)); // 20% of bar height for gap

	const totalSegmentWidth = baseSegmentWidth + baseGap;
	const segmentCount = Math.floor(valueWidth / totalSegmentWidth);
	const maxPossibleSegments = Math.floor(width / totalSegmentWidth);

	for (let i = 0; i < segmentCount && i < maxPossibleSegments; i++) {


		let x;
		if (barDirection === 'right-to-left') {
			x = xRight - (i + 1) * totalSegmentWidth;
		} else {
			x = i * totalSegmentWidth;
		}



		if (x < 0) break;

		// Calculate scale factor based on distance from right edge (particle effect)
		// Segments closer to the right edge (peak indicators) get smaller
		const distanceFromRight = (i + 1) * totalSegmentWidth; // Distance from right edge
		const maxDistance = valueWidth; // Maximum distance for this bar
		const distanceRatio = Math.min(distanceFromRight / maxDistance, 1); // 0 to 1
		const scaleFactor = 1 - (distanceRatio * 0.7); // Scale from 100% to 30%

		const adjustedSegmentWidth = Math.max(1, Math.floor(baseSegmentWidth * scaleFactor));
		const adjustedSegmentHeight = Math.max(1, Math.floor(barHeight * scaleFactor));

		// Center the smaller segments vertically and horizontally in their space
		const xOffset = Math.floor((baseSegmentWidth - adjustedSegmentWidth) / 2);
		const yOffset = Math.floor((barHeight - adjustedSegmentHeight) / 2);

		canvasContext.fillStyle = color;

		// Draw rounded rectangle with scaled size and centered
		const radius = Math.min(1, adjustedSegmentWidth / 2, adjustedSegmentHeight / 2);
		canvasContext.beginPath();
		canvasContext.roundRect(x + xOffset, y + yOffset, adjustedSegmentWidth, adjustedSegmentHeight, radius);
		canvasContext.fill();
	}
}

// Helper function for older browsers that don't support roundRect
function drawRoundedRect(ctx, x, y, width, height, radius) {
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + width - radius, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
	ctx.lineTo(x + width, y + height - radius);
	ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
	ctx.lineTo(x + radius, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

/*
function drawPeakIndicator(xRight, y, peakWidth, barHeight) {
	if (peakWidth <= 0 || isNaN(peakWidth)) return;

	let peakX;
	if (barDirection === 'right-to-left') {
		peakX = Math.max(0, xRight - peakWidth - 2);
	} else {
		peakX = Math.min(width - 2, peakWidth + 2);
	}


	// Only draw peak indicator if it's not at the rest position (right edge)
	if (peakX >= 0 && peakX <= width - 2 && peakX < width - 10) { // 10px threshold from right edge
		canvasContext.fillStyle = '#73c6b6';
		// Draw peak indicator with full bar height + gap to create continuous line
		const extendedHeight = barHeight + BAR_GAP;

		
		const radius = 2;
		canvasContext.beginPath();
		canvasContext.roundRect(peakX, y, 2, extendedHeight, radius);
		canvasContext.fill();


	}
}
*/

function drawPeakIndicator(xRight, y, peakWidth, barHeight) {
	if (peakWidth <= 0 || isNaN(peakWidth)) return;

	let peakX;
	if (barDirection === 'right-to-left') {
		peakX = Math.max(0, xRight - peakWidth - 2);
	} else {
		peakX = Math.min(width - 2, peakWidth + 2);
	}

	if (peakX >= 0 && peakX <= width - 2 && Math.abs(peakX - width) > 10) {
		const circleRadius = Math.min(barHeight, 6) / 2.5;
		const centerY = y + barHeight / 2;
		const centerX = (barDirection === 'right-to-left')
			? Math.max(peakX, circleRadius)
			: Math.min(peakX, width - circleRadius);

		// 🔁 Normalize peak level [0..1]
		const normalizedLevel = Math.min(1, peakWidth / width);

		// 🎨 Interpolate fill color: teal → yellow → red
		let fillColor;
		if (normalizedLevel < 0.5) {
			const ratio = normalizedLevel / 0.5;
			fillColor = interpolateColor('#73c6b6', '#ffff00', ratio);
		} else {
			const ratio = (normalizedLevel - 0.5) / 0.5;
			fillColor = interpolateColor('#ffff00', '#ff0000', ratio);
		}

		canvasContext.fillStyle = fillColor;
		canvasContext.beginPath();
		canvasContext.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
		canvasContext.fill();
	}
}




function interpolateColor(color1, color2, factor) {
	const c1 = hexToRgb(color1);
	const c2 = hexToRgb(color2);
	const r = Math.round(c1.r + (c2.r - c1.r) * factor);
	const g = Math.round(c1.g + (c2.g - c1.g) * factor);
	const b = Math.round(c1.b + (c2.b - c1.b) * factor);
	return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex) {
	const bigint = parseInt(hex.slice(1), 16);
	return {
		r: (bigint >> 16) & 255,
		g: (bigint >> 8) & 255,
		b: bigint & 255
	};
}




function changeBalance(value) {
	const pan = parseFloat(value);
	stereoPanner.pan.value = pan;
	document.getElementById('balanceOutput').value = pan;
}
