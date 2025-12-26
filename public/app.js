class SessionZero {
  constructor() {
    this.conversationArea = document.getElementById('conversationArea');
    this.micButton = document.getElementById('micButton');
    this.startButton = document.getElementById('startButton');
    this.quickStartButton = document.getElementById('quickStartButton');
    this.startButtonsContainer = document.getElementById('startButtons');
    this.startHint = document.getElementById('startHint');
    this.statusEl = document.getElementById('status');
    this.settingsButton = document.getElementById('settingsButton');
    this.settingsPanel = document.getElementById('settingsPanel');
    this.settingsClose = document.getElementById('settingsClose');
    this.audioInputSelect = document.getElementById('audioInput');
    this.visualizerContainer = document.getElementById('visualizerContainer');
    this.visualizerBars = document.querySelectorAll('.viz-bar');

    // Scene elements
    this.sceneList = document.getElementById('sceneList');
    this.endSceneButton = document.getElementById('endSceneButton');
    this.sceneModal = document.getElementById('sceneModal');
    this.sceneModalTitle = document.getElementById('sceneModalTitle');
    this.sceneModalBody = document.getElementById('sceneModalBody');
    this.sceneModalClose = document.getElementById('sceneModalClose');

    this.conversationHistory = [];
    this.scenes = []; // Array of completed scenes
    this.currentSceneMessages = []; // Messages in current scene
    this.sceneCount = 0;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.deepgramSocket = null;
    this.deepgramApiKey = null;
    this.sessionStarted = false;
    this.currentTranscript = '';
    this.sessionMode = 'normal';
    this.selectedAudioDeviceId = null;
    this.analyser = null;
    this.animationFrameId = null;

    this.init();
  }

  async init() {
    this.startButton.addEventListener('click', () => this.startSession('normal'));
    this.quickStartButton.addEventListener('click', () => this.startSession('quick'));
    this.micButton.addEventListener('mousedown', () => this.startRecording());
    this.micButton.addEventListener('mouseup', () => this.stopRecording());
    this.micButton.addEventListener('mouseleave', () => {
      if (this.isRecording) this.stopRecording();
    });

    // Settings panel
    this.settingsButton.addEventListener('click', () => this.toggleSettings());
    this.settingsClose.addEventListener('click', () => this.closeSettings());
    this.audioInputSelect.addEventListener('change', (e) => {
      this.selectedAudioDeviceId = e.target.value || null;
    });

    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.settingsPanel.classList.contains('hidden') &&
          !this.settingsPanel.contains(e.target) &&
          !this.settingsButton.contains(e.target)) {
        this.closeSettings();
      }
    });

    // Load audio devices
    await this.loadAudioDevices();

    // Scene controls
    this.endSceneButton.addEventListener('click', () => this.endCurrentScene());
    this.sceneModalClose.addEventListener('click', () => this.closeSceneModal());
    this.sceneModal.addEventListener('click', (e) => {
      if (e.target === this.sceneModal) this.closeSceneModal();
    });

    // Spacebar push-to-talk
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && this.sessionStarted && !this.isRecording) {
        e.preventDefault();
        this.startRecording();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.isRecording) {
        e.preventDefault();
        this.stopRecording();
      }
    });

    // Fetch Deepgram API key
    try {
      const response = await fetch('/api/deepgram-key');
      const data = await response.json();
      if (data.apiKey) {
        this.deepgramApiKey = data.apiKey;
      } else {
        console.error('Failed to get Deepgram API key');
      }
    } catch (error) {
      console.error('Error fetching Deepgram key:', error);
    }
  }

  async loadAudioDevices() {
    try {
      // Request permission first to get labeled devices
      await navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => stream.getTracks().forEach(track => track.stop()));

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      this.audioInputSelect.innerHTML = '';

      if (audioInputs.length === 0) {
        this.audioInputSelect.innerHTML = '<option value="">No microphones found</option>';
        return;
      }

      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        this.audioInputSelect.appendChild(option);
      });

      // Set default selection
      this.selectedAudioDeviceId = audioInputs[0].deviceId;
    } catch (error) {
      console.error('Error loading audio devices:', error);
      this.audioInputSelect.innerHTML = '<option value="">Microphone access denied</option>';
    }
  }

  toggleSettings() {
    this.settingsPanel.classList.toggle('hidden');
  }

  closeSettings() {
    this.settingsPanel.classList.add('hidden');
  }

  async startSession(mode = 'normal') {
    this.sessionMode = mode;
    this.startButtonsContainer.classList.add('hidden');
    this.startHint.classList.add('hidden');
    this.setStatus('Starting session...', 'processing');

    try {
      const response = await fetch('/api/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Clear welcome message
      this.conversationArea.innerHTML = '';

      // Start first scene
      this.sceneCount = 1;
      this.currentSceneMessages = [];

      // Add GM message
      this.addMessage(data.message, 'gm');
      this.conversationHistory.push({ role: 'assistant', content: data.message });

      this.sessionStarted = true;
      this.micButton.disabled = false;
      this.endSceneButton.disabled = false;
      this.setStatus('Ready - Hold to speak');

    } catch (error) {
      console.error('Failed to start session:', error);
      this.setStatus('Error starting session');
      this.startButtonsContainer.classList.remove('hidden');
      this.startHint.classList.remove('hidden');
    }
  }

  startVisualizerAnimation() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = this.visualizerBars.length;

    const animate = () => {
      if (!this.isRecording) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Map frequency data to bars
      for (let i = 0; i < barCount; i++) {
        // Sample from different parts of the frequency spectrum
        const dataIndex = Math.floor((i / barCount) * bufferLength);
        const value = dataArray[dataIndex];
        // Scale the height (value is 0-255, we want 4-50px)
        const height = Math.max(4, (value / 255) * 50);
        this.visualizerBars[i].style.height = `${height}px`;
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    animate();
  }

  stopVisualizerAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Reset bars to minimum height
    this.visualizerBars.forEach(bar => {
      bar.style.height = '4px';
    });
    this.visualizerContainer.classList.remove('active');
  }

  async startRecording() {
    if (!this.sessionStarted || this.isRecording) return;

    this.isRecording = true;
    this.micButton.classList.add('active');
    this.visualizerContainer.classList.add('active');
    this.setStatus('Listening...', 'listening');
    this.currentTranscript = '';
    this.lastInterimTranscript = '';

    try {
      const audioConstraints = this.selectedAudioDeviceId
        ? { audio: { deviceId: { exact: this.selectedAudioDeviceId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);

      // Connect to Deepgram WebSocket
      // utterance_end_ms: wait longer before finalizing speech
      // endpointing: more forgiving silence detection (higher = more tolerant of pauses)
      this.deepgramSocket = new WebSocket(
        'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&punctuate=true&interim_results=true&utterance_end_ms=1500&endpointing=500',
        ['token', this.deepgramApiKey]
      );

      this.deepgramSocket.onopen = () => {
        console.log('Deepgram connected');

        // Set up audio processing
        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        // Set up analyser for visualizer
        this.analyser = audioContext.createAnalyser();
        this.analyser.fftSize = 64;
        source.connect(this.analyser);

        source.connect(processor);
        processor.connect(audioContext.destination);

        // Start visualizer animation
        this.startVisualizerAnimation();

        processor.onaudioprocess = (e) => {
          if (this.deepgramSocket && this.deepgramSocket.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            this.deepgramSocket.send(pcmData.buffer);
          }
        };

        this.audioContext = audioContext;
        this.processor = processor;
        this.source = source;
        this.mediaStream = stream;
      };

      this.deepgramSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript) {
            if (data.is_final) {
              this.currentTranscript += transcript + ' ';
              this.lastInterimTranscript = ''; // Clear interim when we get final
            } else {
              // Keep track of interim results as fallback
              this.lastInterimTranscript = transcript;
            }
          }
        }
      };

      this.deepgramSocket.onerror = (error) => {
        console.error('Deepgram error:', error);
      };

      this.deepgramSocket.onclose = () => {
        console.log('Deepgram disconnected');
      };

    } catch (error) {
      console.error('Microphone error:', error);
      this.setStatus('Microphone access denied');
      this.isRecording = false;
      this.micButton.classList.remove('active');
    }
  }

  async stopRecording() {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.micButton.classList.remove('active');
    this.stopVisualizerAnimation();
    this.setStatus('Processing...', 'processing');

    // Clean up audio
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Close Deepgram socket gracefully
    if (this.deepgramSocket) {
      // Send close message to allow final processing
      if (this.deepgramSocket.readyState === WebSocket.OPEN) {
        this.deepgramSocket.send(JSON.stringify({ type: 'CloseStream' }));
      }
    }

    // Wait longer for final transcripts to arrive
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close socket after waiting
    if (this.deepgramSocket) {
      this.deepgramSocket.close();
      this.deepgramSocket = null;
    }

    // Use interim transcript as fallback if we didn't get a final
    let transcript = this.currentTranscript.trim();
    if (!transcript && this.lastInterimTranscript) {
      transcript = this.lastInterimTranscript.trim();
    }

    if (!transcript) {
      this.setStatus('No speech detected - try again');
      setTimeout(() => {
        if (!this.isRecording) {
          this.setStatus('Ready - Hold to speak');
        }
      }, 2000);
      return;
    }

    // Add player message
    this.addMessage(transcript, 'player');
    this.conversationHistory.push({ role: 'user', content: transcript });

    // Get GM response
    await this.getGMResponse(transcript);
  }

  async getGMResponse(message) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: this.conversationHistory.slice(0, -1), // Exclude the message we just added
          mode: this.sessionMode,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      this.addMessage(data.message, 'gm');
      this.conversationHistory.push({ role: 'assistant', content: data.message });
      this.setStatus('Ready - Hold to speak');

    } catch (error) {
      console.error('GM response error:', error);
      this.setStatus('Error getting response');
      setTimeout(() => {
        this.setStatus('Ready - Hold to speak');
      }, 2000);
    }
  }

  parseChoices(content) {
    const choicesMatch = content.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
    if (!choicesMatch) return { narrative: content, choices: [] };

    const narrative = content.replace(/\[CHOICES\][\s\S]*?\[\/CHOICES\]/, '').trim();
    const choicesText = choicesMatch[1].trim();

    // Parse numbered choices (1. , 2. , 3. )
    const choices = [];
    const lines = choicesText.split('\n');
    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+)/);
      if (match) {
        choices.push(match[1].trim());
      }
    }

    return { narrative, choices };
  }

  addMessage(content, type, showChoices = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = type === 'gm' ? 'Dungeon Master' : 'You';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (type === 'gm') {
      const { narrative, choices } = this.parseChoices(content);
      contentDiv.textContent = narrative;
      messageDiv.appendChild(label);
      messageDiv.appendChild(contentDiv);

      // Add suggestions button and hidden choices
      if (choices.length > 0 && showChoices) {
        // Create the "Need suggestions?" button
        const suggestionsToggle = document.createElement('button');
        suggestionsToggle.className = 'suggestions-toggle';
        suggestionsToggle.textContent = '💡 Need suggestions?';

        // Create hidden choices container
        const choicesContainer = document.createElement('div');
        choicesContainer.className = 'choices-container hidden';

        choices.forEach((choice, index) => {
          const button = document.createElement('button');
          button.className = 'choice-button';
          button.innerHTML = `
            <span class="choice-number">${index + 1}</span>
            <span class="choice-text">${choice}</span>
          `;
          button.addEventListener('click', () => this.selectChoice(choice, choicesContainer, suggestionsToggle));
          choicesContainer.appendChild(button);
        });

        // Toggle to show/hide choices
        suggestionsToggle.addEventListener('click', () => {
          choicesContainer.classList.toggle('hidden');
          if (choicesContainer.classList.contains('hidden')) {
            suggestionsToggle.textContent = '💡 Need suggestions?';
          } else {
            suggestionsToggle.textContent = '✕ Hide suggestions';
          }
          // Scroll to show choices
          this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
        });

        messageDiv.appendChild(suggestionsToggle);
        messageDiv.appendChild(choicesContainer);
      }
    } else {
      contentDiv.textContent = content;
      messageDiv.appendChild(label);
      messageDiv.appendChild(contentDiv);
    }

    this.conversationArea.appendChild(messageDiv);

    // Track message in current scene
    if (type === 'gm') {
      const { narrative } = this.parseChoices(content);
      this.currentSceneMessages.push({ type: 'gm', content: narrative });
    } else {
      this.currentSceneMessages.push({ type: 'player', content });
    }

    // Scroll to bottom
    this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
  }

  async selectChoice(choice, choicesContainer, suggestionsToggle) {
    // Remove the choices container and toggle button
    choicesContainer.remove();
    if (suggestionsToggle) suggestionsToggle.remove();

    // Add player message
    this.addMessage(choice, 'player');
    this.conversationHistory.push({ role: 'user', content: choice });

    // Get GM response
    this.setStatus('Processing...', 'processing');
    await this.getGMResponse(choice);
  }

  highlightMicButton() {
    this.micButton.classList.add('highlight');
    setTimeout(() => {
      this.micButton.classList.remove('highlight');
    }, 1000);
  }

  setStatus(text, className = '') {
    this.statusEl.textContent = text;
    this.statusEl.className = 'status';
    if (className) {
      this.statusEl.classList.add(className);
    }
  }

  async endCurrentScene() {
    if (this.currentSceneMessages.length === 0) return;

    this.endSceneButton.disabled = true;
    this.setStatus('Ending scene...', 'processing');

    // Ask GM to summarize the scene
    const summaryPrompt = "The player wants to end this scene. Please provide a brief 1-2 sentence summary of what happened and what was revealed about the character, then offer 2-3 new scene options for them to choose from.";

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: summaryPrompt,
          history: this.conversationHistory,
          mode: this.sessionMode,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Save completed scene
      const completedScene = {
        number: this.sceneCount,
        messages: [...this.currentSceneMessages],
        summary: this.extractSummary(data.message),
      };
      this.scenes.push(completedScene);
      this.addSceneToSidebar(completedScene);

      // Clear for new scene
      this.conversationArea.innerHTML = '';
      this.currentSceneMessages = [];
      this.sceneCount++;

      // Add the GM's summary/transition message
      this.addMessage(data.message, 'gm');
      this.conversationHistory.push({ role: 'assistant', content: data.message });

      this.endSceneButton.disabled = false;
      this.setStatus('Ready - Hold to speak');

    } catch (error) {
      console.error('Error ending scene:', error);
      this.setStatus('Error ending scene');
      this.endSceneButton.disabled = false;
    }
  }

  extractSummary(message) {
    // Try to get just the first sentence or two as a summary
    const { narrative } = this.parseChoices(message);
    const sentences = narrative.split(/[.!?]+/).filter(s => s.trim());
    return sentences.slice(0, 2).join('. ').trim() + '.';
  }

  addSceneToSidebar(scene) {
    const sceneItem = document.createElement('div');
    sceneItem.className = 'scene-item';
    sceneItem.innerHTML = `
      <div class="scene-item-number">Scene ${scene.number}</div>
      <div class="scene-item-summary">${scene.summary}</div>
    `;
    sceneItem.addEventListener('click', () => this.showSceneLog(scene));
    this.sceneList.appendChild(sceneItem);
  }

  showSceneLog(scene) {
    this.sceneModalTitle.textContent = `Scene ${scene.number}`;
    this.sceneModalBody.innerHTML = '';

    for (const msg of scene.messages) {
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${msg.type === 'gm' ? 'gm' : 'player'}`;

      const label = document.createElement('div');
      label.className = 'message-label';
      label.textContent = msg.type === 'gm' ? 'Dungeon Master' : 'You';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = msg.content;

      messageDiv.appendChild(label);
      messageDiv.appendChild(contentDiv);
      this.sceneModalBody.appendChild(messageDiv);
    }

    this.sceneModal.classList.remove('hidden');
  }

  closeSceneModal() {
    this.sceneModal.classList.add('hidden');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SessionZero();
});
