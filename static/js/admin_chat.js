document.addEventListener("DOMContentLoaded", function () {
  let currentUserId = null;
  let lastCheckedTimestamp = 0;
  const userList = document.querySelector(".user-list ul");
  const chatMessages = document.getElementById("chat-messages");
  const messageInput = document.getElementById("admin-message-input");
  const sendButton = document.getElementById("admin-send-message");
  let displayedMessageIds = new Set();

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
    if (displayedMessageIds.has(message.id)) {
      return; // 이미 표시된 메시지는 무시
    }

    const messageElement = document.createElement("div");
    messageElement.classList.add(
      "chat-message",
      message.is_user ? "user-message" : "admin-message"
    );
    messageElement.textContent = message.content;
    messageElement.setAttribute("data-message-id", message.id);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    displayedMessageIds.add(message.id);
  }

  // sendMessage 함수 수정
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
              content: message,
              is_user: false,
              timestamp: data.response.timestamp,
            });
            messageInput.value = "";

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
  function startPeriodicChecks() {
    setInterval(() => {
      if (currentUserId) {
        checkForNewMessages();
      }
    }, 1000); // 5초마다 체크
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
            if (!displayedMessageIds.has(message.id)) {
              addMessageToChat(message);
              displayedMessageIds.add(message.id);
              lastCheckedTimestamp = Math.max(
                lastCheckedTimestamp,
                message.timestamp
              );
            }
          });
        })
        .catch((error) =>
          console.error("Error checking for new messages:", error)
        );
    }
  }

  // 주기적으로 새 메시지 확인
  startPeriodicChecks();
});
