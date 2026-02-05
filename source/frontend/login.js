const API_BASE = 'http://127.0.0.1:8899/api';

document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const errorMessage = document.getElementById("errorMessage");
    const successMessage = document.getElementById("successMessage");

    // hide previous messages
    errorMessage.style.display = "none";
    successMessage.style.display = "none";

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            successMessage.textContent = "Login successful! Redirecting...";
            successMessage.style.display = "block";
            setTimeout(() => {
                window.location.href = "hashes.html";
            }, 1000);
        } else {
            errorMessage.textContent = data.error || "Invalid credentials";
            errorMessage.style.display = "block";
        }
    } catch (error) {
        errorMessage.textContent = "An error occurred. Please try again.";
        errorMessage.style.display = "block";
        console.error("Login error:", error);
    }
});