// audio.visualizer.js

// Example usage:
// const visualizer = new AudioVisualizer({
//   canvasId: 'myCanvas',
//   audioElementId: 'player',
//   direction: 'left-to-right',
//   startButtonId: 'startBtn',
//   balanceOutputId: 'balanceOutput',
//   rangeInputSelector: '.controls input[type="range"]'
// });


export class AudioVisualizer {

	constructor({
		canvasId,
		audioElementId,
		direction = 'right-to-left',
		startButtonId,
		balanceOutputId,
		rangeInputSelector
	}) {
		this.canvas = document.getElementById(canvasId);
		this.canvasContext = this.canvas.getContext('2d');
		this.audioElement = document.getElementById(audioElementId);
		this.barDirection = direction;
		this.startButton = document.getElementById(startButtonId);
		this.balanceOutput = document.getElementById(balanceOutputId);
		this.rangeInput = document.querySelector(rangeInputSelector);

		this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		this.analyser = this.audioContext.createAnalyser();
		this.analyserLeft = this.audioContext.createAnalyser();
		this.analyserRight = this.audioContext.createAnalyser();
		this.stereoPanner = this.audioContext.createStereoPanner();
		this.splitter = this.audioContext.createChannelSplitter();

		this.gradient = null;
		this.width = 0;
		this.height = 0;

		this.FREQUENCY_BANDS = 12;
		this.BAR_GAP = 0.5;
		this.PEAK_DECAY = 0.99;
		this.MIN_PEAK_LEVEL = 0;
		this.FREQUENCY_RANGES = [
			{ min: 0, max: 2 }, { min: 2, max: 4 }, { min: 4, max: 6 },
			{ min: 6, max: 9 }, { min: 9, max: 13 }, { min: 13, max: 18 },
			{ min: 18, max: 25 }, { min: 25, max: 35 }, { min: 35, max: 50 },
			{ min: 50, max: 70 }, { min: 70, max: 100 }, { min: 100, max: 140 }
		];

		this.peakLevelsLeft = new Array(this.FREQUENCY_BANDS).fill(0);
		this.peakLevelsRight = new Array(this.FREQUENCY_BANDS).fill(0);

		this.bufferLength = 0;
		this.bufferLengthLeft = 0;
		this.bufferLengthRight = 0;
		this.dataArray = null;
		this.dataArrayLeft = null;
		this.dataArrayRight = null;

		this._bindEvents();
	}

	_bindEvents() {
		this.startButton.addEventListener('click', () => this.start());
		this.rangeInput.addEventListener('input', e => this.setBalance(e.target.value));
	}

	setBalance(value) {
		this.stereoPanner.pan.value = parseFloat(value);
		this.balanceOutput.value = value;
	}

	start() {
		this.startButton.disabled = true;
		this.startButton.style.display = 'none';
		this.audioElement.play().catch(console.warn);
		this._buildAudioGraph();
		requestAnimationFrame(() => this._visualize());
	}

	_buildAudioGraph() {
		const source = this.audioContext.createMediaElementSource(this.audioElement);
		source.connect(this.stereoPanner);
		this.stereoPanner.connect(this.analyser);
		this.analyser.connect(this.audioContext.destination);

		this.analyser.fftSize = 2048;
		this.bufferLength = this.analyser.frequencyBinCount;
		this.dataArray = new Uint8Array(this.bufferLength);

		this.analyserLeft.fftSize = 1024;
		this.analyserRight.fftSize = 1024;
		this.bufferLengthLeft = this.analyserLeft.frequencyBinCount;
		this.bufferLengthRight = this.analyserRight.frequencyBinCount;
		this.dataArrayLeft = new Uint8Array(this.bufferLengthLeft);
		this.dataArrayRight = new Uint8Array(this.bufferLengthRight);

		this.stereoPanner.connect(this.splitter);
		this.splitter.connect(this.analyserLeft, 0);
		this.splitter.connect(this.analyserRight, 1);
	}

	_visualize() {
		this._checkCanvasSize();
		this._clearCanvas();
		this._drawFrequencySpectrum();
		this._drawWaveform();
		requestAnimationFrame(() => this._visualize());
	}

	_checkCanvasSize() {
		const displayWidth = this.canvas.clientWidth;
		const displayHeight = this.canvas.clientHeight;

		if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
			this.canvas.width = displayWidth;
			this.canvas.height = displayHeight;
			this.width = displayWidth;
			this.height = displayHeight;

			// Create consistent gradient regardless of direction
			// Always create left-to-right gradient, we'll handle direction in drawing
			const gradient = this.canvasContext.createLinearGradient(0, 0, this.width, 0);
			
			gradient.addColorStop(0, '#111111');
			gradient.addColorStop(0.15, '#0055ff');
			gradient.addColorStop(0.35, '#00ffff');
			gradient.addColorStop(0.55, '#00ff00');
			gradient.addColorStop(0.75, '#ffff00');
			gradient.addColorStop(0.90, '#ff6600');
			gradient.addColorStop(1, '#ff0000');

			this.gradient = gradient;
		}
	}

	_clearCanvas() {
		this.canvasContext.clearRect(0, 0, this.width, this.height);
	}

	_drawWaveform() {
		this.canvasContext.save();
		this.analyser.getByteTimeDomainData(this.dataArray);

		const maxPeakLeft = Math.max(...this.peakLevelsLeft);
		const maxPeakRight = Math.max(...this.peakLevelsRight);
		const highestPeak = Math.max(maxPeakLeft, maxPeakRight);

		if (highestPeak <= this.MIN_PEAK_LEVEL + 1) {
			this.canvasContext.restore();
			return;
		}

		const peakWidth = this._enhanceScaling(highestPeak, this.width);
		const extraDistance = this.width * 0.1;
		
		let extendedPosition, fadeStartPercent, fadeTransitionPercent;
		
		if (this.barDirection === 'right-to-left') {
			const peakPosition = this.width - peakWidth;
			extendedPosition = Math.max(0, peakPosition - extraDistance);
			fadeStartPercent = Math.max(0.05, Math.min(0.95, extendedPosition / this.width));
			fadeTransitionPercent = Math.min(0.98, fadeStartPercent + 0.05);
		} else {
			// For left-to-right, extend beyond the peak position
			const peakPosition = peakWidth;
			extendedPosition = Math.min(this.width, peakPosition + extraDistance);
			fadeStartPercent = Math.max(0.05, Math.min(0.95, extendedPosition / this.width));
			fadeTransitionPercent = Math.max(0.02, fadeStartPercent - 0.05);
		}

		// Create symmetric waveform gradient
		const gradient = this.canvasContext.createLinearGradient(0, 0, this.width, 0);

		if (this.barDirection === 'right-to-left') {
			gradient.addColorStop(0, '#1d1d1d00');
			gradient.addColorStop(fadeStartPercent, '#1d1d1d00');
			gradient.addColorStop(fadeTransitionPercent, '#1d1d1d40');
			gradient.addColorStop(0.90, '#808080');
			gradient.addColorStop(1, '#ffffff');
		} else {
			gradient.addColorStop(0, '#ffffff');
			gradient.addColorStop(0.10, '#808080');
			gradient.addColorStop(fadeTransitionPercent, '#1d1d1d40');
			gradient.addColorStop(fadeStartPercent, '#1d1d1d00');
			gradient.addColorStop(1, '#1d1d1d00');
		}

		this.canvasContext.lineWidth = 1;
		this.canvasContext.strokeStyle = gradient;
		this.canvasContext.beginPath();

		const sliceWidth = this.width / this.bufferLength;

		if (this.barDirection === 'right-to-left') {
			let x = this.width;
			for (let i = 0; i < this.bufferLength; i++) {
				const v = this.dataArray[i] / 255;
				const y = v * this.height;
				x -= sliceWidth;
				i === 0 ? this.canvasContext.moveTo(x, y) : this.canvasContext.lineTo(x, y);
			}
		} else {
			let x = 0;
			for (let i = 0; i < this.bufferLength; i++) {
				const v = this.dataArray[i] / 255;
				const y = v * this.height;
				i === 0 ? this.canvasContext.moveTo(x, y) : this.canvasContext.lineTo(x, y);
				x += sliceWidth;
			}
		}

		this.canvasContext.stroke();
		this.canvasContext.restore();
	}

	_drawFrequencySpectrum() {
		this.canvasContext.save();
		this.analyserLeft.getByteFrequencyData(this.dataArrayLeft);
		this.analyserRight.getByteFrequencyData(this.dataArrayRight);

		const leftLevels = this._calculateFrequencyBandLevels(this.dataArrayLeft);
		const rightLevels = this._calculateFrequencyBandLevels(this.dataArrayRight);

		const totalGaps = (this.FREQUENCY_BANDS * 2 - 1) * this.BAR_GAP;
		const availableHeight = this.height - totalGaps;
		const barHeight = availableHeight / (this.FREQUENCY_BANDS * 2);

		for (let i = 0; i < this.FREQUENCY_BANDS; i++) {
			const yTop = i * (barHeight + this.BAR_GAP);
			const yBot = this.FREQUENCY_BANDS * (barHeight + this.BAR_GAP) + i * (barHeight + this.BAR_GAP);

			const revIndex = this.FREQUENCY_BANDS - 1 - i;
			const rightLevel = rightLevels[revIndex];
			const leftLevel = leftLevels[i];

			const rightWidth = this._enhanceScaling(rightLevel, this.width);
			const leftWidth = this._enhanceScaling(leftLevel, this.width);

			this._drawSegmentBarHorizontal(this.width, yTop, rightWidth, barHeight, revIndex);
			this._drawSegmentBarHorizontal(this.width, yBot, leftWidth, barHeight, i);

			this.peakLevelsRight[revIndex] = Math.max(this.peakLevelsRight[revIndex] * this.PEAK_DECAY, rightLevel, this.MIN_PEAK_LEVEL);
			this.peakLevelsLeft[i] = Math.max(this.peakLevelsLeft[i] * this.PEAK_DECAY, leftLevel, this.MIN_PEAK_LEVEL);

			const peakRight = this._enhanceScaling(this.peakLevelsRight[revIndex], this.width);
			const peakLeft = this._enhanceScaling(this.peakLevelsLeft[i], this.width);

			this._drawPeakIndicator(this.width, yTop, peakRight, barHeight);
			this._drawPeakIndicator(this.width, yBot, peakLeft, barHeight);
		}

		this.canvasContext.restore();
	}

	_drawSegmentBarHorizontal(xRight, y, valueWidth, barHeight, index) {
		if (valueWidth <= 0 || isNaN(valueWidth)) return;

		const baseSegmentWidth = Math.max(2, Math.floor(barHeight * 0.9));
		const baseGap = Math.max(1, Math.floor(barHeight * 0.2));
		const totalSegmentWidth = baseSegmentWidth + baseGap;
		const segmentCount = Math.floor(valueWidth / totalSegmentWidth);
		const maxSegments = Math.floor(this.width / totalSegmentWidth);

		for (let i = 0; i < segmentCount && i < maxSegments; i++) {
			let x;
			
			if (this.barDirection === 'right-to-left') {
				x = xRight - (i + 1) * totalSegmentWidth;
			} else {
				x = i * totalSegmentWidth;
			}

			if (x < 0 || x > this.width) break;

			const distanceRatio = Math.min(((i + 1) * totalSegmentWidth) / valueWidth, 1);
			const scaleFactor = 1 - distanceRatio * 0.7;

			const segW = Math.max(1, Math.floor(baseSegmentWidth * scaleFactor));
			const segH = Math.max(1, Math.floor(barHeight * scaleFactor));
			const xOffset = Math.floor((baseSegmentWidth - segW) / 2);
			const yOffset = Math.floor((barHeight - segH) / 2);

			const radius = Math.min(1, segW / 2, segH / 2);
			
			// Apply gradient based on direction for consistent color mapping
			if (this.barDirection === 'right-to-left') {
				this.canvasContext.fillStyle = this.gradient;
			} else {
				// Create flipped gradient for left-to-right to maintain color consistency
				const flippedGradient = this.canvasContext.createLinearGradient(this.width, 0, 0, 0);
				flippedGradient.addColorStop(0, '#111111');
				flippedGradient.addColorStop(0.15, '#0055ff');
				flippedGradient.addColorStop(0.35, '#00ffff');
				flippedGradient.addColorStop(0.55, '#00ff00');
				flippedGradient.addColorStop(0.75, '#ffff00');
				flippedGradient.addColorStop(0.90, '#ff6600');
				flippedGradient.addColorStop(1, '#ff0000');
				this.canvasContext.fillStyle = flippedGradient;
			}
			
			this.canvasContext.beginPath();
			this.canvasContext.roundRect(x + xOffset, y + yOffset, segW, segH, radius);
			this.canvasContext.fill();
		}
	}

	_drawPeakIndicator(xRight, y, peakWidth, barHeight) {
		if (peakWidth <= 0 || isNaN(peakWidth)) return;

		const peakOffset = 2;
		let peakX;
		
		if (this.barDirection === 'right-to-left') {
			peakX = Math.max(0, xRight - peakWidth - peakOffset);
		} else {
			peakX = Math.min(this.width - peakOffset, peakWidth + peakOffset);
		}

		if (peakX < 0 || peakX > this.width - peakOffset) return;

		const circleRadius = Math.min(barHeight, 6) / 2.5;
		const centerY = y + barHeight / 2;
		const centerX = this.barDirection === 'right-to-left'
			? Math.max(peakX, circleRadius)
			: Math.min(peakX, this.width - circleRadius);

		const normLevel = Math.min(1, peakWidth / this.width);
		const fillColor = normLevel < 0.5
			? this._interpolateColor('#73c6b6', '#ffff00', normLevel / 0.5)
			: this._interpolateColor('#ffff00', '#ff0000', (normLevel - 0.5) / 0.5);

		this.canvasContext.fillStyle = fillColor;
		this.canvasContext.beginPath();
		this.canvasContext.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
		this.canvasContext.fill();
	}

	_calculateFrequencyBandLevels(frequencyData) {
		const bandLevels = [];
		for (let i = 0; i < this.FREQUENCY_BANDS; i++) {
			const range = this.FREQUENCY_RANGES[i];
			let sum = 0;
			let count = 0;
			for (let bin = range.min; bin < Math.min(range.max, frequencyData.length); bin++) {
				sum += frequencyData[bin];
				count++;
			}
			const average = count > 0 ? sum / count : 0;
			bandLevels.push(average);
		}
		return bandLevels;
	}

	_enhanceScaling(level, maxWidth) {
		const normalized = level / 255;
		return (Math.pow(normalized, 0.6) + Math.sqrt(normalized) * 0.4) * maxWidth * 0.6;
	}

	_interpolateColor(color1, color2, factor) {
		const c1 = this._hexToRgb(color1);
		const c2 = this._hexToRgb(color2);
		const r = Math.round(c1.r + (c2.r - c1.r) * factor);
		const g = Math.round(c1.g + (c2.g - c1.g) * factor);
		const b = Math.round(c1.b + (c2.b - c1.b) * factor);
		return `rgb(${r},${g},${b})`;
	}

	_hexToRgb(hex) {
		const bigint = parseInt(hex.slice(1), 16);
		return {
			r: (bigint >> 16) & 255,
			g: (bigint >> 8) & 255,
			b: bigint & 255
		};
	}
}
