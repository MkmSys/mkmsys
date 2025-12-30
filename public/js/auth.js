// Check if we're on register or login page
const isRegisterPage = window.location.pathname.includes('register.html');

if (isRegisterPage) {
    // Registration form handling
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorMessage = document.getElementById('errorMessage');
        const successMessage = document.getElementById('successMessage');

        // Clear previous messages
        errorMessage.classList.remove('show');
        successMessage.classList.remove('show');

        // Validation
        if (password !== confirmPassword) {
            errorMessage.textContent = 'Passwords do not match';
            errorMessage.classList.add('show');
            return;
        }

        if (password.length < 6) {
            errorMessage.textContent = 'Password must be at least 6 characters';
            errorMessage.classList.add('show');
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                successMessage.textContent = 'Registration successful! Redirecting to login...';
                successMessage.classList.add('show');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1500);
            } else {
                errorMessage.textContent = data.error || 'Registration failed';
                errorMessage.classList.add('show');
            }
        } catch (error) {
            errorMessage.textContent = 'An error occurred. Please try again.';
            errorMessage.classList.add('show');
        }
    });
} else {
    // Login form handling
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorMessage = document.getElementById('errorMessage');

        // Clear previous messages
        errorMessage.classList.remove('show');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                // Store username in sessionStorage
                sessionStorage.setItem('username', data.username);
                // Redirect to messenger
                window.location.href = 'messenger.html';
            } else {
                errorMessage.textContent = data.error || 'Login failed';
                errorMessage.classList.add('show');
            }
        } catch (error) {
            errorMessage.textContent = 'An error occurred. Please try again.';
            errorMessage.classList.add('show');
        }
    });
}

