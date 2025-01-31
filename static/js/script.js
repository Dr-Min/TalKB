document.addEventListener("DOMContentLoaded", function () {
  // DOM 요소
  const chatContainer = document.getElementById("chat-container");
  const userInput = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");
  const voiceBtn = document.getElementById("voice-btn");
  const autoMicToggle = document.getElementById("auto-mic-toggle");
  const authModal = document.getElementById("auth-modal");
  const loginBtn = document.getElementById("login-btn");
  const signupBtn = document.getElementById("signup-btn");
  const authMessage = document.getElementById("auth-message");
  const modalTitle = document.getElementById("modal-title");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const showSignupLink = document.getElementById("show-signup");
  const showLoginLink = document.getElementById("show-login");
  const menuIcon = document.getElementById("menu-icon");
  const sidebar = document.getElementById("sidebar");
  const closeSidebar = document.getElementById("close-sidebar");
  const userId = document.getElementById("user-id");
  const showHistory = document.getElementById("show-history");
  const historyModal = document.getElementById("history-modal");
  const closeHistory = historyModal
    ? historyModal.querySelector(".close")
    : null;
  const historyContainer = document.getElementById("history-container");
  const loadingHistory = document.getElementById("loading-history");
  const showForgotPasswordLink = document.getElementById(
    "show-forgot-password"
  );
  const forgotPasswordForm = document.getElementById("forgot-password-form");
  const backToLoginLink = document.getElementById("back-to-login");
  const resetPasswordBtn = document.getElementById("reset-password-btn");

  // 상태 변수
  let isAutoMicOn = false;
  let isAITalking = false;
  let currentAudio = null;
  let messageCount = 0;
  let isInitialLoad = true;
  let processedMessageIds = new Set();
  let tempMessageId = 0;
  let recognition;
  let isMicrophoneActive = false;
  let isLoading = false;
  let isListening = false;
  let isProcessing = false;
  let silenceTimer;
  let hasSpeechStarted = false;
  let sessionStartTime;
  let isLoggedIn = false;
  const silenceThreshold = 3000;
  let lastProcessedResult = "";
  let isTranslating = false;
  let currentDate = null;
  let isLoadingHistory = false;
  let accumulatedTranscript = "";
  let messageQueue = [];
  let pendingMessage = null;
  let lastCheckedTimestamp = 0;
  let messageIdCounter = 0;
  let currentLoadingAnimation = null;
  let isSubmitting = false;

  const REPORT_INTERVAL = 2;

  window.addEventListener("resize", function () {
    // 화면 크기가 변경될 때 스크롤을 맨 아래로 이동
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });

  // 가상 키보드가 나타날 때 스크롤 조정
  userInput.addEventListener("focus", function () {
    setTimeout(function () {
      window.scrollTo(0, document.body.scrollHeight);
    }, 300); // 키보드가 완전히 나타날 때까지 약간의 지연 시간을 줍니다.
  });
  // 함수 정의
  function playAudio(audioData) {
    if (!audioData) {
      console.error("오디오 데이터가 없습니다.");
      return;
    }
    stopCurrentAudioAndMic();

    const audio = new Audio("data:audio/mp3;base64," + audioData);
    currentAudio = audio;
    isAITalking = true;

    audio.play().catch((error) => {
      console.error("오디오 재생 오류:", error);
      isAITalking = false;
      if (isAutoMicOn) {
        startListening();
      }
    });

    audio.onended = function () {
      isAITalking = false;
      if (isAutoMicOn) {
        startListening();
      }
    };
  }

  function stopCurrentAudioAndMic() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    isAITalking = false;
    stopListening();
  }

  function startListening() {
    if (isAITalking) {
      stopCurrentAudioAndMic();
    }
    if (!recognition) {
      setupSpeechRecognition();
    }
    recognition.start();
    isMicrophoneActive = true;
    voiceBtn.classList.add("active");
    console.log("음성 인식이 시작되었습니다.");
  }

  function stopListening() {
    if (recognition) {
      recognition.stop();
      isMicrophoneActive = false;
      voiceBtn.classList.remove("active");
      console.log("음성 인식이 중지되었습니다.");
    }
  }

  function generateTempId() {
    return `temp_${tempMessageId++}`;
  }

  function sendMessage(message, isVoiceInput = false) {
    if (isSubmitting) return; // 이미 제출 중이면 추가 제출 방지
    isSubmitting = true;
    if (message && message.trim() !== "") {
      const tempId = generateTempId();
      addMessage(message, true, null, true, tempId);

      removeLoadingAnimation();
      currentLoadingAnimation = addLoadingAnimation();

      fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: message, tempId: tempId }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (!data.success) {
            throw new Error("서버에서 오류 응답을 받았습니다.");
          }
          processedMessageIds.add(data.messageId);
          updateMessageId(tempId, data.messageId);
          waitForAdminResponse();
        })
        .catch((error) => {
          console.error("Error:", error);
          removeLoadingAnimation();
          addMessage("메시지 전송 중 오류가 발생했습니다.", false);
        })
        .finally(() => {
          isSubmitting = false; // 제출 완료 후 플래그 리셋
        });

      userInput.value = "";
      if (isVoiceInput) {
        lastProcessedResult = "";
      }
    }
  }

  function loadInitialMessages() {
    console.log("Loading initial messages");
    lastCheckedTimestamp = 0; // Reset timestamp for initial load
    checkForNewMessages().then((hasNewMessages) => {
      if (hasNewMessages) {
        console.log("Initial messages loaded and displayed");
      } else {
        console.log("No initial messages");
      }
    });
  }
  function addLoadingAnimation() {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message bot-message";

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "message-bubble loading";
    loadingDiv.innerHTML = `
      <div class="loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
    messageDiv.appendChild(loadingDiv);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return messageDiv;
  }

  function removeLoadingAnimation() {
    if (currentLoadingAnimation && currentLoadingAnimation.parentNode) {
      currentLoadingAnimation.parentNode.removeChild(currentLoadingAnimation);
    }
    currentLoadingAnimation = null;
  }

  function addMessage(
    message,
    isUser,
    audioData,
    playAudioNow = true,
    tempId = null
  ) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isUser ? "user-message" : "bot-message"}`;
    if (tempId) {
      messageDiv.setAttribute("data-temp-id", tempId);
    }

    const messageBubble = document.createElement("div");
    messageBubble.className = "message-bubble";
    messageBubble.textContent = message;
    messageDiv.appendChild(messageBubble);

    if (!isUser) {
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "message-buttons";

      const translateBtn = document.createElement("button");
      translateBtn.className = "translate-btn";
      translateBtn.textContent = "Translate";
      translateBtn.onclick = function () {
        if (!isTranslating) {
          this.classList.toggle("active");
          translateMessage(message, messageDiv, this);
        } else {
          console.log("번역이 이미 진행 중입니다.");
        }
      };
      buttonContainer.appendChild(translateBtn);

      if (audioData) {
        const audioBtn = document.createElement("button");
        audioBtn.className = "audio-btn";
        audioBtn.innerHTML = '<i class="fas fa-play"></i>';
        audioBtn.onclick = function () {
          playAudio(audioData);
        };
        buttonContainer.appendChild(audioBtn);
      }

      messageDiv.appendChild(buttonContainer);
    }
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    if (!isUser && audioData && playAudioNow) {
      playAudio(audioData);
    }
  }

  function updateMessageId(tempId, realId) {
    const messageDiv = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (messageDiv) {
      messageDiv.removeAttribute("data-temp-id");
      messageDiv.setAttribute("data-message-id", realId);
    }
  }

  function setupSpeechRecognition() {
    if ("webkitSpeechRecognition" in window) {
      recognition = new webkitSpeechRecognition();
    } else if ("SpeechRecognition" in window) {
      recognition = new SpeechRecognition();
    } else {
      console.error("음성 인식이 지원되지 않는 브라우저입니다.");
      return;
    }

    recognition.lang = "ko-KR";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = function () {
      console.log("음성 인식이 시작되었습니다.");
      isListening = true;
      voiceBtn.classList.add("active");
      voiceBtn.classList.add("voice-active");
    };

    recognition.onend = function () {
      console.log("음성 인식이 종료되었습니다.");
      isListening = false;
      hasSpeechStarted = false;
      voiceBtn.classList.remove("active");
      voiceBtn.classList.remove("voice-active");

      if (
        userInput.value.trim() !== "" &&
        userInput.value.trim() !== lastProcessedResult
      ) {
        lastProcessedResult = userInput.value.trim();
        sendMessage(lastProcessedResult);
      }

      if (isAutoMicOn && !isAITalking && !isLoading) {
        startListening();
      }
    };

    recognition.onresult = function (event) {
      clearTimeout(silenceTimer);

      let currentTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentTranscript += event.results[i][0].transcript + " ";
        }
      }

      userInput.value = currentTranscript.trim();

      if (currentTranscript.trim() !== lastProcessedResult.trim()) {
        if (currentTranscript.trim() !== "") {
          lastProcessedResult = currentTranscript.trim();
          sendMessage(lastProcessedResult, true);
        }
      }

      startSilenceTimer();
    };

    recognition.onspeechend = function () {
      console.log("음성 입력이 중지되었습니다.");
      startSilenceTimer();
    };

    recognition.onerror = function (event) {
      console.error("음성 인식 오류", event.error);
      stopListening();
      if (isAutoMicOn) {
        setTimeout(startListening, 1000);
      }
    };
  }

  function startSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isListening) {
        console.log("침묵이 감지되어 음성 인식을 중지합니다.");
        stopListening();
      }
    }, silenceThreshold);
  }

  function onLoginSuccess(username, userId) {
    isLoggedIn = true;
    localStorage.setItem("userId", userId);
    authModal.style.display = "none";
    updateUserId(username);
    sessionStartTime = new Date();
    startUsageTracking();
    loadInitialMessages();
  }

  function login() {
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: username, password: password }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          onLoginSuccess(data.username, data.userId);
        } else {
          setMessage("Failed to log in. Please try again.", "error");
        }
      })
      .catch((error) => {
        console.error("Login error:", error);
        setMessage(
          "An error occurred while logging in. Please try again.",
          "error"
        );
      });
  }

  function isValidEmail(email) {
    const re =
      /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  }

  function signup() {
    const username = document.getElementById("signup-username").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;

    if (!username || !email || !password) {
      setMessage("Please fill in all fields.", "success");
      return;
    }

    if (!email) {
      setMessage(
        "Buddy, don't tell me you don't have an email? It's the 21st century.",
        "success"
      );
      return;
    }

    if (!isValidEmail(email)) {
      setMessage(
        "The email format is wrong. Hey friend, don't you know email formats in the 21st century?",
        "success"
      );
      return;
    }

    if (password.length < 4) {
      setMessage(
        `What? Seriously? A ${password.length}-character password? Please make it longer. (At least 4 characters)`,
        "error"
      );
      return;
    }

    fetch("/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username,
        email: email,
        password: password,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setMessage("Sign up successful. Please log in.", "success");
          showLoginLink.click();
        } else if (data.error === "username_taken") {
          setMessage(
            `Okay, ${username} is a good name, but someone's already using it. Life is first come, first served.`,
            "success"
          );
        } else {
          setMessage(
            "The email is duplicated. Do you already have an account?",
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Signup error:", error);
        setMessage(
          "An error occurred during sign up. Please try again.",
          "error"
        );
      });
  }

  function startUsageTracking() {
    setInterval(() => {
      const currentTime = new Date();
      const usageTime = Math.floor((currentTime - sessionStartTime) / 1000);
      updateUsageTime(usageTime);
    }, 60000);
  }

  function updateUsageTime(time) {
    fetch("/update_usage_time", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ time: time }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          console.error("사용 시간 업데이트 실패");
        }
      })
      .catch((error) => {
        console.error("Usage time update error:", error);
      });
  }

  function translateMessage(message, messageDiv, translateBtn) {
    if (isTranslating) {
      console.log("번역이 이미 진행 중입니다.");
      return;
    }

    const existingTranslation = messageDiv.querySelector(".translation");
    if (existingTranslation) {
      existingTranslation.style.display =
        existingTranslation.style.display === "none" ? "block" : "none";
      return;
    }

    isTranslating = true;
    translateBtn.disabled = true;

    const loadingDiv = addTranslationLoadingAnimation(messageDiv);

    fetch("/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: message }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (data.translation) {
          const translationDiv = document.createElement("div");
          translationDiv.className = "translation";
          translationDiv.textContent = data.translation;
          messageDiv.appendChild(translationDiv);
          translationDiv.style.display = "block";
          chatContainer.scrollTop = chatContainer.scrollHeight;
        } else {
          throw new Error("번역 데이터가 없습니다.");
        }
      })
      .catch((error) => {
        console.error("Translation error:", error);
        addMessage("번역 중 오류가 발생했습니다. 다시 시도해 주세요.", false);
        translateBtn.classList.remove("active");
      })
      .finally(() => {
        removeTranslationLoadingAnimation(loadingDiv);
        isTranslating = false;
        translateBtn.disabled = false;
      });
  }

  function addTranslationLoadingAnimation(container) {
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "loading-animation";
    loadingDiv.innerHTML = '<div class="boxLoading"></div>';
    container.appendChild(loadingDiv);
    return loadingDiv;
  }

  function removeTranslationLoadingAnimation(loadingDiv) {
    if (loadingDiv && loadingDiv.parentNode) {
      loadingDiv.parentNode.removeChild(loadingDiv);
    }
  }

  function updateUserId(username) {
    userId.textContent = username;
  }

  function displayHistory(history) {
    console.log("Displaying history", history);
    if (!historyContainer) {
      console.error("History container not found");
      return;
    }
    historyContainer.innerHTML = "";
    let currentDate = null;
    history.forEach((item) => {
      if (item.date !== currentDate) {
        currentDate = item.date;
        const dateElement = document.createElement("div");
        dateElement.className = "history-date";
        dateElement.textContent = currentDate;
        historyContainer.appendChild(dateElement);
      }
      item.messages.forEach((msg) => {
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${
          msg.is_user ? "user-message" : "bot-message"
        }`;
        messageDiv.innerHTML = `
        <div class="message-bubble">
          ${msg.content}
        </div>
        <div class="message-time">${msg.timestamp}</div>
      `;
        historyContainer.appendChild(messageDiv);
      });
    });
  }

  function loadHistory(date = null) {
    if (isLoadingHistory) return;
    isLoadingHistory = true;
    loadingHistory.style.display = "block";

    fetch(`/get_history?date=${date || ""}`)
      .then((response) => response.json())
      .then((data) => {
        displayHistory(data.history);
        isLoadingHistory = false;
        loadingHistory.style.display = "none";
      })
      .catch((error) => {
        console.error("Error loading history:", error);
        isLoadingHistory = false;
        loadingHistory.style.display = "none";
      });
  }

  function setMessage(message, type) {
    const authMessage = document.getElementById("auth-message");
    if (authMessage) {
      authMessage.textContent = message;
      authMessage.className = type ? type + "-message" : "";
    }
  }

  function clearMessage() {
    const authMessage = document.getElementById("auth-message");
    if (authMessage) {
      authMessage.textContent = "";
      authMessage.className = "";
    }
  }

  function checkLoginStatus() {
    fetch("/check_login")
      .then((response) => response.json())
      .then((data) => {
        if (data.logged_in) {
          onLoginSuccess(data.username, data.userId);
        } else {
          showLoginForm();
        }
      })
      .catch((error) => {
        console.error("Error:", error);
        showLoginForm();
      });
  }

  function showLoginForm() {
    authModal.style.display = "block";
    modalTitle.textContent = "Login";
    loginForm.style.display = "block";
    signupForm.style.display = "none";
  }

  function logout() {
    fetch("/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          isLoggedIn = false;
          showLoginForm();
          sidebar.style.width = "0";
        }
      })
      .catch((error) => console.error("Logout error:", error));
  }

  function waitForAdminResponse() {
    let attempts = 0;
    const maxAttempts = 12; // 1분 동안 시도 (5초 간격으로 12번)

    function checkForResponse() {
      console.log(`Checking for admin response, attempt ${attempts + 1}`);
      if (attempts >= maxAttempts) {
        removeLoadingAnimation();
        // 오류 메시지를 채팅 컨테이너에 추가하는 대신 콘솔에 로그만 남깁니다.
        console.log("응답을 받지 못했습니다. 나중에 다시 시도해주세요.");
        return;
      }

      checkForNewMessages()
        .then((hasAdminResponse) => {
          console.log("Has admin response:", hasAdminResponse);
          if (hasAdminResponse) {
            removeLoadingAnimation();
          } else {
            attempts++;
            setTimeout(checkForResponse, 5000); // 5초 후 다시 시도
          }
        })
        .catch((error) => {
          console.error("Error checking for response:", error);
          attempts++;
          setTimeout(checkForResponse, 5000);
        });
    }

    checkForResponse();
  }

  function checkForNewMessages() {
    console.log("Checking for new messages...");
    console.log(
      "Last checked timestamp:",
      new Date(lastCheckedTimestamp * 1000).toISOString()
    );

    return fetch(
      `/check_new_messages?last_checked=${lastCheckedTimestamp}&_=${Date.now()}`
    )
      .then((response) => response.json())
      .then((data) => {
        console.log("Received response:", data);

        let hasNewMessages = false;
        if (data.new_messages) {
          data.messages.forEach((msg) => {
            if (!processedMessageIds.has(msg.id)) {
              addMessage(msg.content, msg.is_user, msg.audio, true);
              processedMessageIds.add(msg.id);
              if (!msg.is_user) {
                removeLoadingAnimation();
              }
            }
          });

          // Update lastCheckedTimestamp to the latest message timestamp
          if (data.messages.length > 0) {
            lastCheckedTimestamp = Math.max(
              lastCheckedTimestamp,
              ...data.messages.map((msg) => msg.timestamp)
            );
          }
        }

        // Always update to server time if available
        if (data.server_time) {
          lastCheckedTimestamp = data.server_time;
        }
        console.log(
          "Updated last checked timestamp:",
          new Date(lastCheckedTimestamp * 1000).toISOString()
        );

        return hasNewMessages;
      })
      .catch((error) => {
        console.error("Error checking for new messages:", error);
        return false;
      });
  }

  function startPeriodicChecks() {
    setInterval(() => {
      console.log("Performing periodic check for new messages");
      checkForNewMessages().then((hasNewMessages) => {
        if (hasNewMessages) {
          console.log("New messages received and displayed");
        } else {
          console.log("No new messages");
        }
      });
    }, 1000); // 매 1초마다 체크
  }

  // 이벤트 리스너
  sendBtn.addEventListener("click", (e) => {
    e.preventDefault(); // 기본 동작 방지
    const message = userInput.value.trim();
    if (message !== "") {
      sendMessage(message);
    }
  });

  userInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); // 기본 동작 방지
      const message = userInput.value.trim();
      if (message !== "") {
        sendMessage(message);
      }
    }
  });

  voiceBtn.addEventListener("click", function () {
    if (isAITalking) {
      stopCurrentAudioAndMic();
    } else if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  autoMicToggle.addEventListener("click", function () {
    isAutoMicOn = !isAutoMicOn;
    autoMicToggle.textContent = isAutoMicOn ? "Auto Mic: ON" : "Auto Mic: OFF";
    autoMicToggle.classList.toggle("active");
    if (isAutoMicOn && !isAITalking && !isLoading) {
      startListening();
    } else if (!isAutoMicOn) {
      stopListening();
    }
  });

  loginBtn.addEventListener("click", login);
  signupBtn.addEventListener("click", signup);

  showSignupLink.addEventListener("click", function (e) {
    e.preventDefault();
    clearMessage();
    modalTitle.textContent = "Sign Up";
    loginForm.style.display = "none";
    signupForm.style.display = "block";
  });

  showLoginLink.addEventListener("click", function (e) {
    e.preventDefault();
    clearMessage();
    modalTitle.textContent = "Login";
    signupForm.style.display = "none";
    loginForm.style.display = "block";
  });

  menuIcon.addEventListener("click", function () {
    sidebar.style.width = "50%";
  });

  closeSidebar.addEventListener("click", function () {
    sidebar.style.width = "0";
  });

  showHistory.addEventListener("click", function () {
    historyModal.style.display = "block";
    historyContainer.innerHTML = "<p>Loading history...</p>";
    currentDate = null;
    loadHistory();
    console.log("History modal opened");
  });

  if (closeHistory) {
    closeHistory.addEventListener("click", function () {
      historyModal.style.display = "none";
    });
  }

  if (historyContainer) {
    historyContainer.addEventListener("scroll", () => {
      if (historyContainer.scrollTop === 0 && !isLoadingHistory) {
        loadHistory(currentDate);
      }
    });
  }

  if (showForgotPasswordLink) {
    showForgotPasswordLink.addEventListener("click", function (e) {
      e.preventDefault();
      clearMessage();
      loginForm.style.display = "none";
      signupForm.style.display = "none";
      forgotPasswordForm.style.display = "block";
      modalTitle.textContent = "Reset Password";
    });
  }

  if (backToLoginLink) {
    backToLoginLink.addEventListener("click", function (e) {
      e.preventDefault();
      clearMessage();
      forgotPasswordForm.style.display = "none";
      loginForm.style.display = "block";
      modalTitle.textContent = "Login";
    });
  }

  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener("click", function () {
      const email = document.getElementById("reset-email").value;
      if (!isValidEmail(email)) {
        setMessage("Please enter a valid email address.", "error");
        return;
      }
      requestPasswordReset(email);
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  // 초기 설정
  setupSpeechRecognition();
  checkLoginStatus();
  loadInitialMessages();
  startPeriodicChecks();
});
