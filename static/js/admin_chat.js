document.addEventListener("DOMContentLoaded", function () {
  let currentUserId = null;
  let lastCheckedTimestamp = 0;
  let processedMessageIds = new Set();
  const userList = document.querySelector(".user-list ul");
  const chatMessages = document.getElementById("chat-messages");
  const messageInput = document.getElementById("admin-message-input");
  const sendButton = document.getElementById("admin-send-message");

  userList.addEventListener("click", function (e) {
    if (e.target.classList.contains("user-link")) {
      e.preventDefault();
      const userId = e.target.dataset.userId;
      selectUser(userId);
    }
  });

  function selectUser(userId) {
    currentUserId = userId;
    processedMessageIds.clear();
    lastCheckedTimestamp = 0;
    loadChatHistory(userId);

    // Highlight selected user
    document.querySelectorAll(".user-link").forEach((el) => el.classList.remove("active"));
    document.querySelector(`.user-link[data-user-id="${userId}"]`).classList.add("active");
  }

  function loadChatHistory(userId) {
    chatMessages.innerHTML = "";
    checkForNewMessages();
  }

  function addMessageToChat(message) {
    const messageElement = document.createElement("div");
    messageElement.classList.add(
      "chat-message",
      message.is_user ? "user-message" : "admin-message"
    );
    messageElement.textContent = message.content;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  sendButton.addEventListener("click", sendMessage);
  messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendMessage();
    }
  });

  function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentUserId) {
      console.log("Sending admin message:", message);

      fetch("/admin/send_response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: currentUserId,
          response: message,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          console.log("Server response:", data);
          if (data.success) {
            addMessageToChat({
              id: data.response.id,
              content: message,
              is_user: false,
              timestamp: data.response.timestamp,
            });
            messageInput.value = "";
            processedMessageIds.add(data.response.id);

            // 관리자 메시지를 보낸 후 즉시 새 메시지 확인
            checkForNewMessages();
          } else {
            console.error("Error sending message:", data.error);
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        });
    }
  }

  function checkForNewMessages() {
    if (currentUserId) {
      console.log("Checking for new messages...");
      console.log("Last checked timestamp:", new Date(lastCheckedTimestamp * 1000).toISOString());

      fetch(`/check_new_messages?last_checked=${lastCheckedTimestamp}&user_id=${currentUserId}&_=${Date.now()}`)
        .then((response) => response.json())
        .then((data) => {
          console.log("Received response:", data);

          if (data.new_messages) {
            data.messages.forEach((msg) => {
              if (!processedMessageIds.has(msg.id)) {
                addMessageToChat(msg);
                processedMessageIds.add(msg.id);
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
          console.log("Updated last checked timestamp:", new Date(lastCheckedTimestamp * 1000).toISOString());
        })
        .catch((error) => {
          console.error("Error checking for new messages:", error);
        });
    }
  }

  function startPeriodicChecks() {
    setInterval(() => {
      console.log("Performing periodic check for new messages");
      checkForNewMessages();
    }, 1000); // 매 1초마다 체크
  }

  // 주기적으로 새 메시지 확인
  startPeriodicChecks();
});
