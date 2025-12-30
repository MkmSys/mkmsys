# Local Messenger Application

A beautiful, fully-functional messenger application that runs on a local server with user registration, login, and real-time messaging capabilities.

## Features

- ✅ User Registration
- ✅ User Login
- ✅ Username Search
- ✅ Real-time Messaging
- ✅ Modern, Responsive UI
- ✅ Message History

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Register a new account:**
   - Click on "Register here" from the login page
   - Enter a username and password (minimum 6 characters)
   - Click Register

2. **Login:**
   - Enter your username and password
   - Click Login

3. **Search for users:**
   - Use the search bar in the sidebar to find other users
   - Click on a user from the search results to start chatting

4. **Send messages:**
   - Select a user from your contacts or search results
   - Type your message in the input field
   - Press Enter or click Send

5. **Logout:**
   - Click the Logout button in the sidebar header

## Project Structure

```
.
├── server.js              # Backend server (Express + Socket.io)
├── package.json           # Dependencies
├── users.json             # User data (auto-generated)
├── messages.json          # Message history (auto-generated)
├── public/
│   ├── index.html         # Login page
│   ├── register.html      # Registration page
│   ├── messenger.html     # Main messenger interface
│   ├── css/
│   │   └── style.css      # All styling
│   └── js/
│       ├── auth.js        # Authentication logic
│       └── messenger.js   # Messenger functionality
└── README.md              # This file
```

## Technologies Used

- **Backend:** Node.js, Express.js, Socket.io
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Security:** bcrypt for password hashing
- **Storage:** JSON files (users.json, messages.json)

## Notes

- All user data and messages are stored locally in JSON files
- The application uses sessionStorage to maintain login state
- Real-time messaging is powered by Socket.io
- Passwords are securely hashed using bcrypt

## Troubleshooting

- **Port already in use:** Change the PORT in server.js or set environment variable `PORT`
- **Dependencies not installing:** Make sure you have Node.js and npm installed
- **Messages not sending:** Check browser console for errors and ensure the server is running

