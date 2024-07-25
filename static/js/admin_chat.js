document.addEventListener("DOMContentLoaded", function () {
  let currentUserId = null;
  let lastCheckedTimestamp = 0;
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
    loadChatHistory(userId);

    // Highlight selected user
    document
      .querySelectorAll(".user-link")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelector(`.user-link[data-user-id="${userId}"]`)
      .classList.add("active");
  }

  function loadChatHistory(userId) {
    chatMessages.innerHTML = "";
    fetch(`/admin/chat/${userId}`)
      .then((response) => response.json())
      .then((messages) => {
        messages.forEach(addMessageToChat);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      });
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
          if (data.success) {
            addMessageToChat({
              content: message,
              is_user: false,
              timestamp: Date.now() / 1000,
            });
            messageInput.value = "";
            lastCheckedTimestamp = Date.now() / 1000;
          } else {
            console.error("Error sending message:", data.error);
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        });
    }
  }
  function sendAdminResponse(userId, message) {
    fetch("/admin/send_response", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        response: message,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          addMessage(data.response.content, false, data.response.audio);
          messageInput.value = "";
        } else {
          console.error("Error sending message:", data.error);
        }
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  }

  function checkForNewMessages() {
    if (currentUserId) {
      fetch(`/admin/chat/${currentUserId}?last_checked=${lastCheckedTimestamp}`)
        .then((response) => response.json())
        .then((messages) => {
          messages.forEach((message) => {
            addMessageToChat(message);
            lastCheckedTimestamp = Math.max(
              lastCheckedTimestamp,
              message.timestamp
            );
          });
        })
        .catch((error) =>
          console.error("Error checking for new messages:", error)
        );
    }
  }

  // 주기적으로 새 메시지 확인
  setInterval(checkForNewMessages, 5000); // 5초마다 확인
});
