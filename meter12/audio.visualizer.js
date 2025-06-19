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
		rangeInputSelector,
		inputSource = 'audio-element', // 'audio-element' or 'microphone'
		sourceSelectId = null
	}) {
		this.canvas = document.getElementById(canvasId);
		this.canvasContext = this.canvas.getContext('2d');
		this.audioElement = document.getElementById(audioElementId);
		this.barDirection = direction;
		this.startButton = document.getElementById(startButtonId);
		this.balanceOutput = document.getElementById(balanceOutputId);
		this.rangeInput = document.querySelector(rangeInputSelector);
		this.inputSource = inputSource;
		this.sourceSelect = sourceSelectId ? document.getElementById(sourceSelectId) : null;

		this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		this.analyser = this.audioContext.createAnalyser();
		this.analyserLeft = this.audioContext.createAnalyser();
		this.analyserRight = this.audioContext.createAnalyser();
		this.stereoPanner = this.audioContext.createStereoPanner();
		this.splitter = this.audioContext.createChannelSplitter();

		this.gradient = null;
		this.width = 0;
		this.height = 0;
		this.microphoneStream = null;
		this.audioSource = null;
		this.mediaElementSource = null; // Track the media element source separately

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
		
		if (this.sourceSelect) {
			this.sourceSelect.addEventListener('change', e => this.setInputSource(e.target.value));
		}
	}

	setInputSource(source) {
		this.inputSource = source;
		// If currently running, restart with new source
		if (this.audioSource) {
			this._disconnectCurrentSource();
			this.start();
		}
	}

	setBalance(value) {
		this.stereoPanner.pan.value = parseFloat(value);
		this.balanceOutput.value = value;
	}

	start() {
		this.startButton.disabled = true;
		this.startButton.style.display = 'none';
		
		// Disconnect any existing source first
		this._disconnectCurrentSource();
		
		if (this.inputSource === 'microphone') {
			this._startMicrophoneInput();
		} else {
			this.audioElement.play().catch(console.warn);
			this._buildAudioGraph();
		}
		
		requestAnimationFrame(() => this._visualize());
	}

	stop() {
		this._disconnectCurrentSource();
		this._stopMicrophone();
		
		if (this.audioElement && !this.audioElement.paused) {
			this.audioElement.pause();
		}
		
		this.startButton.disabled = false;
		this.startButton.style.display = 'block';
	}

	_disconnectCurrentSource() {
		if (this.audioSource) {
			try {
				this.audioSource.disconnect();
			} catch (e) {
				// Source might already be disconnected
			}
			this.audioSource = null;
		}
	}

	_stopMicrophone() {
		if (this.microphoneStream) {
			this.microphoneStream.getTracks().forEach(track => track.stop());
			this.microphoneStream = null;
		}
	}

	async _startMicrophoneInput() {
		try {
			// Stop any existing microphone stream first
			this._stopMicrophone();
			
			this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				} 
			});
			this._buildMicrophoneAudioGraph();
		} catch (error) {
			console.error('Error accessing microphone:', error);
			alert('Could not access microphone. Please check permissions.');
			this.stop();
		}
	}

	_buildAudioGraph() {
		// Reuse existing media element source or create new one
		if (!this.mediaElementSource) {
			this.mediaElementSource = this.audioContext.createMediaElementSource(this.audioElement);
		}
		
		this.audioSource = this.mediaElementSource;
		this.audioSource.connect(this.stereoPanner);
		this.stereoPanner.connect(this.analyser);
		this.analyser.connect(this.audioContext.destination);

		this._setupAnalysers();
	}

	_buildMicrophoneAudioGraph() {
		this.audioSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
		this.audioSource.connect(this.stereoPanner);
		this.stereoPanner.connect(this.analyser);
		// Note: Don't connect to destination for microphone to avoid feedback

		this._setupAnalysers();
	}

	_setupAnalysers() {
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

			// Always create left-to-right gradient for consistent color mapping
			const gradient = this.canvasContext.createLinearGradient(0, 0, this.width, 0);
			
			gradient.addColorStop(1, '#111111');
			gradient.addColorStop(0.90, '#0055ff');
			gradient.addColorStop(0.75, '#00ffff');
			gradient.addColorStop(0.55, '#00ff00');
			gradient.addColorStop(0.35, '#ffff00');
			gradient.addColorStop(0.15, '#ff6600');
			gradient.addColorStop(0, '#ff0000');			

			this.gradient = gradient;
		}
	}

	_clearCanvas() {
		this.canvasContext.clearRect(0, 0, this.width, this.height);
	}

	_drawWaveform() {
		this.canvasContext.save();
		
		// Apply transformation for right-to-left to flip it (since the base logic draws left-to-right) 
		if (this.barDirection === 'right-to-left') {
			this.canvasContext.scale(-1, 1);
			this.canvasContext.translate(-this.width, 0);
		}
		
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
		
		// Calculate for left-to-right positioning (natural drawing state)
		const peakPosition = peakWidth;
		const extendedPosition = Math.min(this.width, peakPosition + extraDistance);
		const fadeStartPercent = Math.max(0.05, Math.min(0.95, extendedPosition / this.width));
		const fadeTransitionPercent = Math.max(0.02, fadeStartPercent - 0.05);

		// Create waveform gradient for left-to-right (natural drawing)
		const gradient = this.canvasContext.createLinearGradient(0, 0, this.width, 0);
		gradient.addColorStop(0, '#ffffff');
		gradient.addColorStop(0.10, '#808080');
		gradient.addColorStop(fadeTransitionPercent, '#1d1d1d40');
		gradient.addColorStop(fadeStartPercent, '#1d1d1d00');
		gradient.addColorStop(1, '#1d1d1d00');

		this.canvasContext.lineWidth = 1;
		this.canvasContext.strokeStyle = gradient;
		this.canvasContext.beginPath();

		const sliceWidth = this.width / this.bufferLength;

		// Draw left-to-right (natural state), transformation flips for right-to-left
		let x = 0;
		for (let i = 0; i < this.bufferLength; i++) {
			const v = this.dataArray[i] / 255;
			const y = v * this.height;
			i === 0 ? this.canvasContext.moveTo(x, y) : this.canvasContext.lineTo(x, y);
			x += sliceWidth;
		}

		this.canvasContext.stroke();
		this.canvasContext.restore();
	}

	_drawFrequencySpectrum() {
		this.canvasContext.save();
		
		// Apply transformation for right-to-left to flip it (since the base logic draws left-to-right)
		if (this.barDirection === 'right-to-left') {
			this.canvasContext.scale(-1, 1);
			this.canvasContext.translate(-this.width, 0);
		}
		
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

			// Update peak levels with proper decay to zero
			this.peakLevelsRight[revIndex] = Math.max(this.peakLevelsRight[revIndex] * this.PEAK_DECAY, rightLevel);
			this.peakLevelsLeft[i] = Math.max(this.peakLevelsLeft[i] * this.PEAK_DECAY, leftLevel);
			
			// Apply faster decay in the final moments for more natural disappearance
			const rightScaled = this._enhanceScaling(this.peakLevelsRight[revIndex], this.width);
			const leftScaled = this._enhanceScaling(this.peakLevelsLeft[i], this.width);
			
			// When peaks are getting very small (< 10 pixels), apply faster decay
			if (rightScaled < 10 && rightScaled > 0) {
				this.peakLevelsRight[revIndex] *= 0.85; // Faster decay for final moments
			}
			if (leftScaled < 10 && leftScaled > 0) {
				this.peakLevelsLeft[i] *= 0.85; // Faster decay for final moments
			}
			
			// Recalculate after potential faster decay
			const rightScaledFinal = this._enhanceScaling(this.peakLevelsRight[revIndex], this.width);
			const leftScaledFinal = this._enhanceScaling(this.peakLevelsLeft[i], this.width);
			
			if (rightScaledFinal < 1) this.peakLevelsRight[revIndex] = 0;
			if (leftScaledFinal < 1) this.peakLevelsLeft[i] = 0;

			const peakRight = this._enhanceScaling(this.peakLevelsRight[revIndex], this.width);
			const peakLeft = this._enhanceScaling(this.peakLevelsLeft[i], this.width);

			// Only draw peak indicators if they have meaningful visual width (at least 1 pixel)
			if (peakRight > 1) {
				this._drawPeakIndicator(this.width, yTop, peakRight, barHeight);
			}
			if (peakLeft > 1) {
				this._drawPeakIndicator(this.width, yBot, peakLeft, barHeight);
			}
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

		this.canvasContext.fillStyle = this.gradient;

		for (let i = 0; i < segmentCount && i < maxSegments; i++) {
			// Always use left-to-right positioning since transformation is handled at higher level
			const x = i * totalSegmentWidth;

			if (x < 0 || x > this.width) break;

			const distanceRatio = Math.min(((i + 1) * totalSegmentWidth) / valueWidth, 1);
			const scaleFactor = 1 - distanceRatio * 0.7;

			const segW = Math.max(1, Math.floor(baseSegmentWidth * scaleFactor));
			const segH = Math.max(1, Math.floor(barHeight * scaleFactor));
			const xOffset = Math.floor((baseSegmentWidth - segW) / 2);
			const yOffset = Math.floor((barHeight - segH) / 2);

			const radius = Math.min(1, segW / 2, segH / 2);
			
			this.canvasContext.beginPath();
			this.canvasContext.roundRect(x + xOffset, y + yOffset, segW, segH, radius);
			this.canvasContext.fill();
		}
	}

	_drawPeakIndicator(xRight, y, peakWidth, barHeight) {
		// Don't draw peak indicator if there's no peak or it's at zero
		if (peakWidth <= 0 || isNaN(peakWidth)) return;

		const peakOffset = 2;
		// Always position from left since transformation handles the direction
		const peakX = Math.min(this.width - peakOffset, peakWidth + peakOffset);

		if (peakX < 0 || peakX > this.width - peakOffset) return;

		const circleRadius = Math.min(barHeight, 6) / 2.5;
		const centerY = y + barHeight / 2;
		const centerX = Math.min(peakX, this.width - circleRadius);

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
