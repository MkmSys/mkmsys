// Mobile detection and server configuration
const isMobileApp = document.body.classList.contains('mobile-app') || window.AndroidWebView;
let SERVER_URL = 'https://fave.up.railway.app';

// If running in Android app, use the configured server URL
if (window.Android) {
    try {
        const config = JSON.parse(window.Android.getUserData());
        if (config.server_url) {
            SERVER_URL = config.server_url;
        }
    } catch (e) {
        console.log('Using default server URL');
    }
}

// Check if user is logged in (different handling for mobile vs web)
let username = null;
let authToken = null;

if (isMobileApp && window.Android) {
    // Mobile app authentication
    authToken = window.Android.getAuthToken();
    if (!authToken) {
        // Redirect to login in mobile app
        if (window.Android.openLogin) {
            window.Android.openLogin();
        }
        window.location.href = 'index.html';
    } else {
        try {
            const userData = JSON.parse(window.Android.getUserData());
            username = userData.username;
        } catch (e) {
            console.error('Failed to parse user data');
        }
    }
} else {
    // Web app authentication
    username = sessionStorage.getItem('username');
    if (!username) {
        window.location.href = 'index.html';
    }
}

// Initialize Socket.io with authentication
let socket;
if (authToken) {
    socket = io(SERVER_URL, {
        auth: {
            token: authToken
        }
    });
} else {
    socket = io(SERVER_URL);
}

// Set current username
if (username) {
    document.getElementById('currentUsername').textContent = username;
}

// Connect to socket with username
if (username) {
    socket.emit('login', username);
}

// State
let currentChatUser = null;
let currentChatType = 'user'; // 'user' or 'group'
let currentGroupId = null;
let searchTimeout = null;
let groupSearchTimeout = null;
let contactTimestamps = {}; // Track last message time for sorting
let callPeerConnection = null;
let groupCallConnections = new Map(); // Map of username -> RTCPeerConnection for group calls
let localStream = null;
let remoteStream = null;
let isCallActive = false;
let isGroupCall = false;
let callType = null; // 'audio' or 'video'
let callWith = null;
let currentGroupCallId = null;

// New state variables
let currentUserProfile = null;
let selectedMessageId = null;
let selectedUserForContext = null;
let contextMenuX = 0;
let contextMenuY = 0;

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// Theme initialization
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);

// DOM Elements
const userSearch = document.getElementById('userSearch');
const searchResults = document.getElementById('searchResults');
const contactsList = document.getElementById('contactsList');
const chatHeader = document.getElementById('chatHeader');
const chatHeaderActions = document.getElementById('chatHeaderActions');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const messageInputContainer = document.getElementById('messageInputContainer');
const sendBtn = document.getElementById('sendBtn');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggle = document.getElementById('themeToggle');
const tabBtns = document.querySelectorAll('.tab-btn');
const groupsSection = document.getElementById('groupsSection');
const createGroupBtn = document.getElementById('createGroupBtn');
const groupSearch = document.getElementById('groupSearch');
const groupSearchResults = document.getElementById('groupSearchResults');
const voiceCallBtn = document.getElementById('voiceCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');
const callModal = document.getElementById('callModal');
const callVideoContainer = document.getElementById('callVideoContainer');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');
const localVideo = document.getElementById('localVideo');
const endCallBtn = document.getElementById('endCallBtn');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const callStatus = document.getElementById('callStatus');
const callUser = document.getElementById('callUser');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const videoMessageBtn = document.getElementById('videoMessageBtn');
const voiceMessageBtn = document.getElementById('voiceMessageBtn');
const recordingUI = document.getElementById('recordingUI');
const recordingTimer = document.getElementById('recordingTimer');
const recordingPreview = document.getElementById('recordingPreview');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const cancelRecordingBtn = document.getElementById('cancelRecordingBtn');
const pinnedMessagesBtn = document.getElementById('pinnedMessagesBtn');
const pinnedMessagesSection = document.getElementById('pinnedMessagesSection');
const pinnedMessagesList = document.getElementById('pinnedMessagesList');
const closePinnedBtn = document.getElementById('closePinnedBtn');

// New DOM Elements for new features
const profileBtn = document.getElementById('profileBtn');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const profileModal = document.getElementById('profileModal');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const profileAvatar = document.getElementById('profileAvatar');
const avatarInput = document.getElementById('avatarInput');
const changeAvatarBtn = document.getElementById('changeAvatarBtn');
const displayNameInput = document.getElementById('displayNameInput');
const bioInput = document.getElementById('bioInput');
const blockedUsersList = document.getElementById('blockedUsersList');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelProfileBtn = document.getElementById('cancelProfileBtn');
const messageContextMenu = document.getElementById('messageContextMenu');
const userContextMenu = document.getElementById('userContextMenu');
const deleteMessageBtn = document.getElementById('deleteMessageBtn');
const pinMessageBtn = document.getElementById('pinMessageBtn');
const blockUserBtn = document.getElementById('blockUserBtn');
const viewProfileBtn = document.getElementById('viewProfileBtn');
const deleteAccountModal = document.getElementById('deleteAccountModal');
const deletePasswordInput = document.getElementById('deletePasswordInput');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingType = null; // 'video' or 'audio'
let recordingStartTime = null;
let recordingInterval = null;

// Theme toggle
themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

// Tab switching
const userSearchSection = userSearch.parentElement;
const groupSearchSection = document.getElementById('groupSearchSection');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (tab === 'groups') {
            groupsSection.style.display = 'block';
            userSearchSection.style.display = 'none';
            if (groupSearchSection) groupSearchSection.style.display = 'block';
            loadUserGroups();
        } else {
            groupsSection.style.display = 'none';
            userSearchSection.style.display = 'block';
            if (groupSearchSection) groupSearchSection.style.display = 'none';
        }
    });
});

// Logout functionality
logoutBtn.addEventListener('click', () => {
    if (isMobileApp && window.Android) {
        // Mobile app logout
        window.Android.logout();
    } else {
        // Web app logout
        sessionStorage.removeItem('username');
        window.location.href = 'index.html';
    }
});

// Mobile-specific features
if (isMobileApp) {
    // Add profile button for mobile
    const profileBtn = document.createElement('button');
    profileBtn.innerHTML = '👤 Profile';
    profileBtn.className = 'mobile-profile-btn';
    profileBtn.onclick = () => {
        if (window.Android && window.Android.openProfile) {
            window.Android.openProfile();
        }
    };

    // Add to header or sidebar
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (sidebarHeader) {
        sidebarHeader.appendChild(profileBtn);
    }

    // Mobile-specific styling
    const style = document.createElement('style');
    style.textContent = `
        .mobile-profile-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            margin-left: 10px;
            font-size: 12px;
        }
        .mobile-app .sidebar {
            width: 100vw;
        }
        .mobile-app .chat-area {
            width: 100vw;
        }
    `;
    document.head.appendChild(style);
}

// User search functionality
userSearch.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    clearTimeout(searchTimeout);
    
    if (query.length === 0) {
        searchResults.classList.remove('show');
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${SERVER_URL}/api/users/search?q=${encodeURIComponent(query)}&from=${encodeURIComponent(username)}`);
            const users = await response.json();
            
            if (users.length === 0) {
                searchResults.innerHTML = '<div class="search-result-item">No users found</div>';
            } else {
                searchResults.innerHTML = users.map(user => 
                    `<div class="search-result-item" data-username="${user.username}">
                        ${user.avatar ? `<img src="${user.avatar}" class="contact-avatar" alt="Avatar">` : ''}
                        <div class="contact-info">
                            <div class="contact-name">${user.displayName || user.username}</div>
                        </div>
                    </div>`
                ).join('');
                
                // Add click handlers
                searchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const selectedUsername = item.getAttribute('data-username');
                        if (selectedUsername) {
                            openChat(selectedUsername, 'user');
                            userSearch.value = '';
                            searchResults.classList.remove('show');
                        }
                    });
                    
                    // Add context menu for right-click
                    item.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        selectedUserForContext = item.getAttribute('data-username');
                        showUserContextMenu(e.clientX, e.clientY);
                    });
                });
            }
            
            searchResults.classList.add('show');
        } catch (error) {
            console.error('Search error:', error);
        }
    }, 300);
});

// Group search functionality
groupSearch.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    clearTimeout(groupSearchTimeout);
    
    if (query.length === 0) {
        groupSearchResults.classList.remove('show');
        return;
    }

    groupSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${SERVER_URL}/api/groups/search?q=${encodeURIComponent(query)}`);
            const groups = await response.json();
            
            if (groups.length === 0) {
                groupSearchResults.innerHTML = '<div class="search-result-item">No groups found</div>';
            } else {
                groupSearchResults.innerHTML = groups.map(group => 
                    `<div class="search-result-item group-result" data-group-id="${group.id}" data-group-name="${group.name}">
                        ${group.name} (${group.id})
                    </div>`
                ).join('');
                
                // Add click handlers
                groupSearchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        const groupId = item.getAttribute('data-group-id');
                        const groupName = item.getAttribute('data-group-name');
                        if (groupId) {
                            try {
                                await fetch(`${SERVER_URL}/api/groups/join`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ groupId, username })
                                });
                                openChat(groupId, 'group', groupName);
                                groupSearch.value = '';
                                groupSearchResults.classList.remove('show');
                                loadUserGroups();
                            } catch (error) {
                                console.error('Join group error:', error);
                            }
                        }
                    });
                });
            }
            
            groupSearchResults.classList.add('show');
        } catch (error) {
            console.error('Group search error:', error);
        }
    }, 300);
});

// Create group
createGroupBtn.addEventListener('click', async () => {
    const groupName = prompt('Enter group name:');
    if (!groupName) return;
    
    try {
        const response = await fetch(`${SERVER_URL}/api/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: groupName, createdBy: username })
        });
        const result = await response.json();
        if (result.success) {
            alert(`Group created! ID: ${result.group.id}`);
            openChat(result.group.id, 'group', result.group.name);
            loadUserGroups();
        }
    } catch (error) {
        console.error('Create group error:', error);
    }
});

// Load user's groups
async function loadUserGroups() {
    try {
        const response = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
        const groups = await response.json();
        
        // Add groups to contact list (only if not already added)
        groups.forEach(group => {
            const existing = contactsList.querySelector(`[data-username="${group.id}"].group-item`);
            if (!existing) {
                addGroupToList(group.id, group.name);
            }
        });
    } catch (error) {
        console.error('Load groups error:', error);
    }
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!userSearch.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.remove('show');
    }
    if (!groupSearch.contains(e.target) && !groupSearchResults.contains(e.target)) {
        groupSearchResults.classList.remove('show');
    }
});

// Open chat with a user or group
async function openChat(target, type, displayName) {
    currentChatType = type;
    
    // Add animation to messages container
    messagesContainer.style.opacity = '0';
    
    if (type === 'group') {
        currentGroupId = target;
        currentChatUser = displayName || target;
        chatHeaderActions.style.display = 'flex'; // Enable calls for groups
    } else {
        currentChatUser = target;
        currentGroupId = null;
        chatHeaderActions.style.display = 'flex';
    }
    
    // Update UI - clear header first
    const noChatSelected = chatHeader.querySelector('.no-chat-selected');
    if (noChatSelected) noChatSelected.remove();
    
    // Get or create header content container
    let headerContentContainer = chatHeader.querySelector('.chat-header-content');
    if (!headerContentContainer) {
        headerContentContainer = document.createElement('div');
        headerContentContainer.className = 'chat-header-content';
        chatHeader.insertBefore(headerContentContainer, chatHeaderActions);
    }
    
    // Update header content with animation
    let headerContent = headerContentContainer.querySelector('h3');
    if (!headerContent) {
        headerContent = document.createElement('h3');
        headerContentContainer.appendChild(headerContent);
    }
    headerContent.textContent = currentChatUser;
    
    messageInputContainer.style.display = 'flex';
    
    // Add to contacts if not already there
    if (type === 'group') {
        addGroupToList(currentGroupId, currentChatUser);
    } else {
        addContactToList(currentChatUser);
    }
    
    // Load chat history
    try {
        const url = type === 'group' 
            ? `${SERVER_URL}/api/messages?groupId=${encodeURIComponent(currentGroupId)}`
            : `${SERVER_URL}/api/messages?from=${encodeURIComponent(username)}&to=${encodeURIComponent(target)}`;
        const response = await fetch(url);
        const messages = await response.json();
        
        displayMessages(messages);
        
        // Fade in messages container
        setTimeout(() => {
            messagesContainer.style.opacity = '1';
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
    } catch (error) {
        console.error('Error loading messages:', error);
        messagesContainer.style.opacity = '1';
    }
    
    // Clear notification badge
    const contactItem = contactsList.querySelector(`[data-username="${type === 'group' ? currentGroupId : currentChatUser}"]`);
    if (contactItem) {
        const badge = contactItem.querySelector('.notification-badge');
        if (badge) badge.remove();
    }
}

// Add contact to list with sorting by timestamp
function addContactToList(contactUsername) {
    // Check if contact already exists
    const existingContact = contactsList.querySelector(`[data-username="${contactUsername}"]:not(.group-item)`);
    if (existingContact) {
        // Move to top based on timestamp and mark as active
        updateContactOrder();
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
        });
        existingContact.classList.add('active');
        return;
    }
    
    // Create new contact item
    const contactItem = document.createElement('div');
    contactItem.className = 'contact-item active';
    contactItem.setAttribute('data-username', contactUsername);
    
    // Get user profile for avatar and display name
    fetch(`${SERVER_URL}/api/users/profile/${contactUsername}`)
        .then(response => response.json())
        .then(profile => {
            const displayName = profile.displayName || contactUsername;
            const avatarHtml = profile.avatar ? `<img src="${profile.avatar}" class="contact-avatar" alt="Avatar">` : '';
            
            contactItem.innerHTML = `
                ${avatarHtml}
                <div class="contact-info">
                    <div class="contact-name">${displayName}</div>
                    <div class="contact-last-message"></div>
                </div>
            `;
        })
        .catch(() => {
            // Fallback if profile fetch fails
            contactItem.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name">${contactUsername}</div>
                    <div class="contact-last-message"></div>
                </div>
            `;
        });
    
    contactItem.addEventListener('click', () => {
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
        });
        contactItem.classList.add('active');
        openChat(contactUsername, 'user');
    });
    
    // Add context menu for right-click
    contactItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectedUserForContext = contactUsername;
        showUserContextMenu(e.clientX, e.clientY);
    });
    
    // Remove "no contacts" message if exists
    const noContacts = contactsList.querySelector('.no-contacts');
    if (noContacts) {
        noContacts.remove();
    }
    
    // Add to list and sort
    contactsList.appendChild(contactItem);
    updateContactOrder();
}

// Add group to list
function addGroupToList(groupId, groupName) {
    // Check if group already exists
    const existingGroup = contactsList.querySelector(`[data-username="${groupId}"].group-item`);
    if (existingGroup) {
        updateContactOrder();
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
        });
        existingGroup.classList.add('active');
        return;
    }
    
    // Create new group item
    const groupItem = document.createElement('div');
    groupItem.className = 'contact-item group-item';
    groupItem.setAttribute('data-username', groupId);
    groupItem.setAttribute('data-is-group', 'true');
    groupItem.innerHTML = `<span class="contact-name">${groupName}</span>`;
    
    groupItem.addEventListener('click', () => {
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
        });
        groupItem.classList.add('active');
        openChat(groupId, 'group', groupName);
    });
    
    // Remove "no contacts" message if exists
    const noContacts = contactsList.querySelector('.no-contacts');
    if (noContacts) {
        noContacts.remove();
    }
    
    // Add to list and sort
    contactsList.appendChild(groupItem);
    updateContactOrder();
}

// Update contact order based on last message timestamp
function updateContactOrder() {
    const items = Array.from(contactsList.querySelectorAll('.contact-item'));
    
    items.sort((a, b) => {
        const aId = a.getAttribute('data-username');
        const bId = b.getAttribute('data-username');
        const aTime = contactTimestamps[aId] || 0;
        const bTime = contactTimestamps[bId] || 0;
        return bTime - aTime; // Most recent first
    });
    
    items.forEach(item => contactsList.appendChild(item));
}

// Update timestamp for a contact/group
function updateContactTimestamp(contactId, timestamp) {
    contactTimestamps[contactId] = timestamp;
    updateContactOrder();
}

// Load initial contacts from message history
async function loadInitialContacts() {
    try {
        const response = await fetch(`${SERVER_URL}/api/messages?all=true&from=${encodeURIComponent(username)}`);
        const allMessages = await response.json();
        
        const userChats = new Set();
        allMessages.forEach(msg => {
            if (msg.groupId) {
                userChats.add(`group:${msg.groupId}`);
            } else if (msg.from === username && msg.to) {
                userChats.add(msg.to);
            } else if (msg.to === username && msg.from) {
                userChats.add(msg.from);
            }
        });
        
        // Load groups first to get group names
        const groupsResponse = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
        const userGroups = await groupsResponse.json();
        const groupsMap = new Map(userGroups.map(g => [g.id, g.name]));
        
        // Load groups into list
        await loadUserGroups();
        
        // For each user chat, get last message timestamp
        userChats.forEach(chatId => {
            if (chatId.startsWith('group:')) {
                const groupId = chatId.replace('group:', '');
                const groupMessages = allMessages.filter(m => m.groupId === groupId);
                if (groupMessages.length > 0) {
                    const lastMsg = groupMessages[groupMessages.length - 1];
                    contactTimestamps[groupId] = new Date(lastMsg.timestamp).getTime();
                    // Ensure group is in list with correct name
                    const groupName = groupsMap.get(groupId);
                    if (groupName) {
                        const existing = contactsList.querySelector(`[data-username="${groupId}"].group-item`);
                        if (!existing) {
                            addGroupToList(groupId, groupName);
                        }
                    }
                }
            } else {
                const userMessages = allMessages.filter(m => 
                    (m.from === username && m.to === chatId) || 
                    (m.from === chatId && m.to === username)
                );
                if (userMessages.length > 0) {
                    const lastMsg = userMessages[userMessages.length - 1];
                    contactTimestamps[chatId] = new Date(lastMsg.timestamp).getTime();
                    addContactToList(chatId);
                }
            }
        });
        
        updateContactOrder();
    } catch (error) {
        console.error('Load contacts error:', error);
    }
}

// Display messages
function displayMessages(messages) {
    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="no-messages"><p>No messages yet. Start the conversation!</p></div>';
        pinnedMessagesBtn.style.display = 'none';
        return;
    }
    
    // Check if there are pinned messages
    const hasPinnedMessages = messages.some(msg => msg.pinned);
    pinnedMessagesBtn.style.display = hasPinnedMessages ? 'inline-block' : 'none';
    
    messagesContainer.innerHTML = messages.map((msg, index) => {
        const isSent = msg.from === username;
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const sender = currentChatType === 'group' && !isSent ? `<strong>${escapeHtml(msg.from)}:</strong> ` : '';
        const pinnedClass = msg.pinned ? 'pinned' : '';
        
        // Get user avatar for the message sender
        let avatarHtml = '';
        if (!isSent && currentChatType === 'user') {
            // For direct messages, show the other user's avatar
            const otherUser = currentChatUser;
            // We would need to get the avatar from the user profile, but for now we'll use a placeholder
            avatarHtml = `<img src="/api/placeholder-avatar/${otherUser}" class="message-avatar" alt="Avatar" onerror="this.style.display='none'">`;
        }
        
        let content = '';
        
        if (msg.isVideoMessage) {
            content = `
                <div class="video-message">
                    <video src="${msg.fileUrl}" preload="metadata"></video>
                    <div class="play-overlay">▶</div>
                </div>
            `;
        } else if (msg.isVoiceMessage) {
            content = `
                <div class="voice-message ${isSent ? 'sent' : ''}">
                    <button class="voice-play-btn">▶</button>
                    <div class="voice-waveform">
                        ${Array(20).fill(0).map(() => `<div class="voice-bar" style="height: ${Math.random() * 30 + 10}px;"></div>`).join('')}
                    </div>
                    <div class="voice-duration">${formatDuration(msg.duration || 0)}</div>
                    <audio src="${msg.fileUrl}" preload="metadata"></audio>
                </div>
            `;
        } else if (msg.fileUrl && !msg.isVideoMessage && !msg.isVoiceMessage) {
            content = `
                <div class="file-message ${isSent ? 'sent' : ''}">
                    <div class="file-icon">📎</div>
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(msg.fileName || 'File')}</div>
                        <div class="file-size">${formatFileSize(msg.fileSize || 0)}</div>
                    </div>
                    <a href="${msg.fileUrl}" download class="file-download">Download</a>
                </div>
            `;
        } else {
            content = `<div class="message-bubble">${sender}${escapeHtml(msg.message || '')}</div>`;
        }
        
        const messageHtml = `
            <div class="message ${isSent ? 'sent' : 'received'} ${pinnedClass}" data-message-id="${msg.id}" style="animation-delay: ${index * 0.05}s">
                ${avatarHtml ? `<div class="message-content-with-avatar">${avatarHtml}<div class="message-text-with-avatar">${content}</div></div>` : content}
                <div class="message-info">
                    ${time}
                    <button class="message-pin-btn" onclick="togglePinMessage('${msg.id}', ${msg.pinned || false})" title="${msg.pinned ? 'Unpin' : 'Pin'} message">
                        ${msg.pinned ? '📌' : '📍'}
                    </button>
                </div>
            </div>
        `;
        
        return messageHtml;
    }).join('');
    
    // Add event handlers for video messages
    messagesContainer.querySelectorAll('.video-message').forEach(videoMsg => {
        const video = videoMsg.querySelector('video');
        const overlay = videoMsg.querySelector('.play-overlay');
        videoMsg.addEventListener('click', () => {
            if (video.paused) {
                video.play();
                overlay.style.display = 'none';
            } else {
                video.pause();
                overlay.style.display = 'flex';
            }
        });
    });
    
    // Add event handlers for voice messages
    messagesContainer.querySelectorAll('.voice-play-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const audio = btn.parentElement.querySelector('audio');
            if (audio.paused) {
                audio.play();
                btn.textContent = '⏸';
                audio.onended = () => {
                    btn.textContent = '▶';
                };
            } else {
                audio.pause();
                btn.textContent = '▶';
            }
        });
    });
    
    // Add context menu for messages
    messagesContainer.querySelectorAll('.message').forEach(messageElement => {
        messageElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const messageId = messageElement.getAttribute('data-message-id');
            showMessageContextMenu(e.clientX, e.clientY, messageId);
        });
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Toggle pin message
async function togglePinMessage(messageId, currentlyPinned) {
    try {
        const response = await fetch(`${SERVER_URL}/api/messages/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, pinned: !currentlyPinned })
        });
        
        const result = await response.json();
        if (result.success) {
            // Reload messages to show updated pin status
            if (currentChatType === 'group') {
                openChat(currentGroupId, 'group', currentChatUser);
            } else {
                openChat(currentChatUser, 'user');
            }
        }
    } catch (error) {
        console.error('Error pinning message:', error);
    }
}

// Make togglePinMessage available globally
window.togglePinMessage = togglePinMessage;

// Send message
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || (!currentChatUser && !currentGroupId)) return;
    
    // Add sending animation to button
    sendBtn.classList.add('message-sending');
    
    const messageData = currentChatType === 'group' 
        ? { groupId: currentGroupId, message }
        : { to: currentChatUser, message };
    
    socket.emit('sendMessage', messageData);
    
    messageInput.value = '';
    
    // Remove sending animation
    setTimeout(() => {
        sendBtn.classList.remove('message-sending');
    }, 300);
    
    // Update timestamp for contact
    const contactId = currentChatType === 'group' ? currentGroupId : currentChatUser;
    updateContactTimestamp(contactId, Date.now());
}

// File upload handlers
attachBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
        await uploadAndSendFile(file);
    }
    fileInput.value = '';
});

// Video message handler
videoMessageBtn.addEventListener('click', () => {
    startVideoRecording();
});

// Voice message handler
voiceMessageBtn.addEventListener('click', () => {
    startVoiceRecording();
});

// Recording controls
stopRecordingBtn.addEventListener('click', () => {
    stopRecording();
});

cancelRecordingBtn.addEventListener('click', () => {
    cancelRecording();
});

// Pinned messages
pinnedMessagesBtn.addEventListener('click', () => {
    loadPinnedMessages();
    pinnedMessagesSection.style.display = 'flex';
});

closePinnedBtn.addEventListener('click', () => {
    pinnedMessagesSection.style.display = 'none';
});

// Send button click
sendBtn.addEventListener('click', sendMessage);

// Enter key to send
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Show notification
function showNotification(title, body) {
    if (isMobileApp && window.Android) {
        // Mobile app notification
        window.Android.showNotification(title, body);
    } else if ('Notification' in window && Notification.permission === 'granted') {
        // Web notification
        new Notification(title, { body, icon: '/favicon.ico' });
    }
}

// Call functionality
async function startCall(type) {
    if (!currentChatUser) return;
    
    callType = type;
    isCallActive = true;
    
    if (currentChatType === 'group') {
        // Group call
        isGroupCall = true;
        currentGroupCallId = currentGroupId;
        callWith = null;
        await startGroupCall(type);
    } else {
        // Direct call
        isGroupCall = false;
        callWith = currentChatUser;
        await startDirectCall(type);
    }
}

async function startDirectCall(type) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
        });
        
        callVideoContainer.classList.remove('group-call');
        remoteVideosContainer.innerHTML = '';
        
        localVideo.srcObject = localStream;
        if (type === 'video') {
            localVideo.style.display = 'block';
        }
        
        callPeerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        localStream.getTracks().forEach(track => {
            callPeerConnection.addTrack(track, localStream);
        });
        
        callPeerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            const remoteVideo = document.createElement('video');
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.srcObject = remoteStream;
            remoteVideo.id = 'remoteVideo';
            remoteVideosContainer.appendChild(remoteVideo);
        };
        
        callPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('callIceCandidate', {
                    to: callWith,
                    candidate: event.candidate
                });
            }
        };
        
        const offer = await callPeerConnection.createOffer();
        await callPeerConnection.setLocalDescription(offer);
        
        socket.emit('callOffer', {
            to: callWith,
            offer,
            type
        });
        
        callModal.style.display = 'flex';
        callStatus.textContent = 'Calling...';
        callUser.textContent = callWith;
    } catch (error) {
        console.error('Call error:', error);
        alert('Error starting call. Please check your permissions.');
        isCallActive = false;
    }
}

async function startGroupCall(type) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
        });
        
        callVideoContainer.classList.add('group-call');
        remoteVideosContainer.innerHTML = '';
        
        localVideo.srcObject = localStream;
        if (type === 'video') {
            localVideo.style.display = 'block';
        }
        
        // Get group members
        const response = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
        const groups = await response.json();
        const group = groups.find(g => g.id === currentGroupCallId);
        
        if (!group) {
            alert('Group not found');
            return;
        }
        
        // Create peer connections for each group member
        const otherMembers = group.members.filter(m => m !== username);
        
        for (const member of otherMembers) {
            const peerConnection = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            peerConnection.ontrack = (event) => {
                const remoteStream = event.streams[0];
                addRemoteVideo(member, remoteStream);
            };
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('groupCallIceCandidate', {
                        groupId: currentGroupCallId,
                        candidate: event.candidate,
                        to: member
                    });
                }
            };
            
            groupCallConnections.set(member, peerConnection);
            
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('groupCallOffer', {
                groupId: currentGroupCallId,
                offer,
                type
            });
        }
        
        callModal.style.display = 'flex';
        callStatus.textContent = `Calling ${otherMembers.length} participant(s)...`;
        callUser.textContent = currentChatUser;
    } catch (error) {
        console.error('Group call error:', error);
        alert('Error starting group call. Please check your permissions.');
        isCallActive = false;
        isGroupCall = false;
    }
}

function addRemoteVideo(username, stream) {
    const existingVideo = remoteVideosContainer.querySelector(`[data-user="${username}"]`);
    
    if (existingVideo) {
        existingVideo.srcObject = stream;
        return;
    }
    
    const videoItem = document.createElement('div');
    videoItem.className = 'remote-video-item';
    videoItem.setAttribute('data-user', username);
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = username;
    
    videoItem.appendChild(video);
    videoItem.appendChild(label);
    remoteVideosContainer.appendChild(videoItem);
}

function removeRemoteVideo(username) {
    const videoItem = remoteVideosContainer.querySelector(`[data-user="${username}"]`);
    if (videoItem) {
        videoItem.remove();
    }
}

voiceCallBtn.addEventListener('click', () => startCall('audio'));
videoCallBtn.addEventListener('click', () => startCall('video'));

endCallBtn.addEventListener('click', () => {
    endCall();
});

async function endCall() {
    if (isGroupCall) {
        // End group call
        groupCallConnections.forEach((peerConnection, member) => {
            peerConnection.close();
        });
        groupCallConnections.clear();
        
        socket.emit('callEnd', { groupId: currentGroupCallId });
        currentGroupCallId = null;
        isGroupCall = false;
    } else {
        // End direct call
        if (callPeerConnection) {
            callPeerConnection.close();
            callPeerConnection = null;
        }
        
        if (callWith) {
            socket.emit('callEnd', { to: callWith });
            callWith = null;
        }
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    remoteVideosContainer.querySelectorAll('video').forEach(video => {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
        }
    });
    
    localVideo.srcObject = null;
    remoteVideosContainer.innerHTML = '';
    callModal.style.display = 'none';
    isCallActive = false;
}

toggleMuteBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        toggleMuteBtn.textContent = audioTracks[0]?.enabled ? '🔇' : '🔊';
    }
});

toggleVideoBtn.addEventListener('click', () => {
    if (localStream) {
        const videoTracks = localStream.getVideoTracks();
        videoTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        localVideo.style.display = videoTracks[0]?.enabled ? 'block' : 'none';
    }
});

// Socket event handlers
socket.on('newMessage', async (messageData) => {
    const contactId = messageData.groupId || (messageData.from === username ? messageData.to : messageData.from);
    const timestamp = new Date(messageData.timestamp).getTime();
    updateContactTimestamp(contactId, timestamp);
    
    // Add notification badge
    const contactItem = contactsList.querySelector(`[data-username="${contactId}"]`);
    if (contactItem) {
        let badge = contactItem.querySelector('.notification-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notification-badge';
            contactItem.querySelector('.contact-name').appendChild(badge);
        }
        const count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
    }
    
    // Show notification if not the current chat
    const isCurrentChat = (currentChatType === 'group' && messageData.groupId === currentGroupId) ||
                          (currentChatType === 'user' && currentChatUser && (
                              messageData.from === currentChatUser || 
                              messageData.to === currentChatUser
                          ));
    
    if (!isCurrentChat) {
        const senderName = messageData.groupId ? `${messageData.from} in ${contactId}` : messageData.from;
        showNotification(`New message from ${senderName}`, messageData.message);
    }
    
        // Reload messages if this is the current chat
    if (isCurrentChat) {
        if (currentChatType === 'group') {
            openChat(currentGroupId, 'group', currentChatUser);
        } else {
            openChat(currentChatUser, 'user');
        }
    } else {
        // Add to contact list if not exists
        if (messageData.groupId) {
            // Need to get group name
            try {
                const response = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
                const groups = await response.json();
                const group = groups.find(g => g.id === messageData.groupId);
                if (group) {
                    addGroupToList(messageData.groupId, group.name);
                }
            } catch (error) {
                console.error('Error loading group:', error);
            }
        } else {
            const otherUser = messageData.from === username ? messageData.to : messageData.from;
            addContactToList(otherUser);
        }
    }
});

socket.on('messageSent', async (messageData) => {
    const contactId = messageData.groupId || messageData.to;
    updateContactTimestamp(contactId, Date.now());
    
    // Reload messages if this is the current chat
    if (currentChatType === 'group' && messageData.groupId === currentGroupId) {
        openChat(currentGroupId, 'group', currentChatUser);
    } else if (currentChatType === 'user' && messageData.to === currentChatUser) {
        openChat(currentChatUser, 'user');
    }
});

// Call signaling events
socket.on('callOffer', async (data) => {
    const { from, offer, type } = data;
    
    if (!confirm(`Incoming ${type === 'video' ? 'video' : 'voice'} call from ${from}. Accept?`)) {
        socket.emit('callEnd', { to: from });
        return;
    }
    
    callType = type;
    callWith = from;
    isCallActive = true;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
        });
        
        localVideo.srcObject = localStream;
        if (type === 'video') {
            localVideo.style.display = 'block';
        }
        
        callPeerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        localStream.getTracks().forEach(track => {
            callPeerConnection.addTrack(track, localStream);
        });
        
        callVideoContainer.classList.remove('group-call');
        remoteVideosContainer.innerHTML = '';
        
        callPeerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            const remoteVideo = document.createElement('video');
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.srcObject = remoteStream;
            remoteVideo.id = 'remoteVideo';
            remoteVideosContainer.appendChild(remoteVideo);
        };
        
        callPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('callIceCandidate', {
                    to: from,
                    candidate: event.candidate
                });
            }
        };
        
        await callPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await callPeerConnection.createAnswer();
        await callPeerConnection.setLocalDescription(answer);
        
        socket.emit('callAnswer', {
            to: from,
            answer
        });
        
        callModal.style.display = 'flex';
        callStatus.textContent = 'In call';
        callUser.textContent = from;
    } catch (error) {
        console.error('Call accept error:', error);
        endCall();
    }
});

socket.on('callAnswer', async (data) => {
    const { from, answer } = data;
    
    if (!isGroupCall && callPeerConnection) {
        await callPeerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        callStatus.textContent = 'In call';
    }
});

socket.on('callIceCandidate', async (data) => {
    const { from, candidate } = data;
    
    if (callPeerConnection) {
        await callPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('callEnd', (data) => {
    endCall();
});

// Group call socket event handlers
socket.on('groupCallOffer', async (data) => {
    const { groupId, from, offer, type } = data;
    
    if (!confirm(`Incoming ${type === 'video' ? 'video' : 'voice'} call in group. Accept?`)) {
        socket.emit('callEnd', { groupId });
        return;
    }
    
    isGroupCall = true;
    isCallActive = true;
    currentGroupCallId = groupId;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
        });
        
        callVideoContainer.classList.add('group-call');
        remoteVideosContainer.innerHTML = '';
        
        localVideo.srcObject = localStream;
        if (type === 'video') {
            localVideo.style.display = 'block';
        }
        
        // Create peer connection for the caller
        const peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            addRemoteVideo(from, remoteStream);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('groupCallIceCandidate', {
                    groupId,
                    candidate: event.candidate,
                    to: from
                });
            }
        };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('groupCallAnswer', {
            groupId,
            answer,
            to: from
        });
        
        groupCallConnections.set(from, peerConnection);
        
        // Get other participants and connect to them
        socket.emit('getGroupCallParticipants', { groupId });
        
        callModal.style.display = 'flex';
        callStatus.textContent = 'In call';
        const response = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
        const groups = await response.json();
        const group = groups.find(g => g.id === groupId);
        callUser.textContent = group ? group.name : groupId;
    } catch (error) {
        console.error('Group call accept error:', error);
        endCall();
    }
});

socket.on('groupCallAnswer', async (data) => {
    const { groupId, from, answer } = data;
    
    const peerConnection = groupCallConnections.get(from);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        callStatus.textContent = 'In call';
    }
});

socket.on('groupCallIceCandidate', async (data) => {
    const { groupId, from, candidate } = data;
    
    const peerConnection = groupCallConnections.get(from);
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('groupCallParticipants', async (data) => {
    const { groupId, participants } = data;
    
    if (groupId !== currentGroupCallId) return;
    
    // Connect to other participants who are already in the call
    const response = await fetch(`${SERVER_URL}/api/groups/user/${encodeURIComponent(username)}`);
    const groups = await response.json();
    const group = groups.find(g => g.id === groupId);
    
    if (!group) return;
    
    const otherParticipants = participants.filter(p => p !== username && !groupCallConnections.has(p));
    
    for (const participant of otherParticipants) {
        const peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            addRemoteVideo(participant, remoteStream);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('groupCallIceCandidate', {
                    groupId,
                    candidate: event.candidate,
                    to: participant
                });
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send offer to existing participant
        socket.emit('groupCallOffer', {
            groupId,
            offer,
            type: callType
        });
        
        groupCallConnections.set(participant, peerConnection);
    }
});

socket.on('groupCallParticipantJoined', (data) => {
    const { groupId, from } = data;
    if (groupId === currentGroupCallId && !groupCallConnections.has(from)) {
        callStatus.textContent = `${from} joined the call`;
    }
});

socket.on('groupCallParticipantLeft', (data) => {
    const { groupId, from } = data;
    if (groupId === currentGroupCallId) {
        const peerConnection = groupCallConnections.get(from);
        if (peerConnection) {
            peerConnection.close();
            groupCallConnections.delete(from);
        }
        removeRemoteVideo(from);
        callStatus.textContent = `${from} left the call`;
    }
});

socket.on('groupCallEnd', (data) => {
    const { groupId, from } = data;
    if (groupId === currentGroupCallId) {
        endCall();
    }
});

// File upload function
async function uploadAndSendFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${SERVER_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (result.success) {
            const messageData = currentChatType === 'group' 
                ? { 
                    groupId: currentGroupId, 
                    fileUrl: result.fileUrl,
                    fileType: result.fileType,
                    fileName: result.fileName,
                    message: `📎 ${result.fileName}`
                }
                : { 
                    to: currentChatUser, 
                    fileUrl: result.fileUrl,
                    fileType: result.fileType,
                    fileName: result.fileName,
                    message: `📎 ${result.fileName}`
                };
            
            socket.emit('sendMessage', messageData);
            
            const contactId = currentChatType === 'group' ? currentGroupId : currentChatUser;
            updateContactTimestamp(contactId, Date.now());
        }
    } catch (error) {
        console.error('File upload error:', error);
        alert('Error uploading file');
    }
}

// Video recording functions
async function startVideoRecording() {
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        recordingType = 'video';
        
        const video = document.createElement('video');
        video.srcObject = recordingStream;
        video.autoplay = true;
        video.muted = true;
        video.style.width = '200px';
        video.style.height = '200px';
        video.style.borderRadius = '50%';
        video.style.objectFit = 'cover';
        
        recordingPreview.innerHTML = '';
        recordingPreview.appendChild(video);
        
        mediaRecorder = new MediaRecorder(recordingStream, {
            mimeType: 'video/webm;codecs=vp8,opus'
        });
        
        recordedChunks = [];
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.start();
        recordingStartTime = Date.now();
        recordingUI.style.display = 'flex';
        messageInputContainer.style.display = 'none';
        
        recordingInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            recordingTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    } catch (error) {
        console.error('Error starting video recording:', error);
        alert('Error accessing camera. Please check permissions.');
    }
}

// Voice recording functions
async function startVoiceRecording() {
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordingType = 'audio';
        
        mediaRecorder = new MediaRecorder(recordingStream, {
            mimeType: 'audio/webm'
        });
        
        recordedChunks = [];
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.start();
        recordingStartTime = Date.now();
        recordingUI.style.display = 'flex';
        messageInputContainer.style.display = 'none';
        
        // Show audio waveform visualization
        recordingPreview.innerHTML = '<div class="voice-waveform" id="voiceWaveform"></div>';
        const waveform = document.getElementById('voiceWaveform');
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'voice-bar';
            bar.style.height = '20px';
            waveform.appendChild(bar);
        }
        
        recordingInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            recordingTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    } catch (error) {
        console.error('Error starting voice recording:', error);
        alert('Error accessing microphone. Please check permissions.');
    }
}

async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
    }
    
    if (recordingInterval) {
        clearInterval(recordingInterval);
    }
    
    recordingUI.style.display = 'none';
    messageInputContainer.style.display = 'flex';
    
    mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: recordingType === 'video' ? 'video/webm' : 'audio/webm' });
        const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
        
        const formData = new FormData();
        const fileName = recordingType === 'video' ? `video-${Date.now()}.webm` : `voice-${Date.now()}.webm`;
        formData.append('file', blob, fileName);
        
        try {
            const response = await fetch(`${SERVER_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            if (result.success) {
                const messageData = currentChatType === 'group' 
                    ? { 
                        groupId: currentGroupId, 
                        fileUrl: result.fileUrl,
                        fileType: result.fileType,
                        fileName: result.fileName,
                        isVideoMessage: recordingType === 'video',
                        isVoiceMessage: recordingType === 'audio',
                        duration: duration
                    }
                    : { 
                        to: currentChatUser, 
                        fileUrl: result.fileUrl,
                        fileType: result.fileType,
                        fileName: result.fileName,
                        isVideoMessage: recordingType === 'video',
                        isVoiceMessage: recordingType === 'audio',
                        duration: duration
                    };
                
                socket.emit('sendMessage', messageData);
                
                const contactId = currentChatType === 'group' ? currentGroupId : currentChatUser;
                updateContactTimestamp(contactId, Date.now());
            }
        } catch (error) {
            console.error('Error uploading recording:', error);
            alert('Error uploading recording');
        }
        
        recordedChunks = [];
        recordingStream = null;
        mediaRecorder = null;
    };
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
    }
    
    if (recordingInterval) {
        clearInterval(recordingInterval);
    }
    
    recordedChunks = [];
    recordingStream = null;
    mediaRecorder = null;
    recordingUI.style.display = 'none';
    messageInputContainer.style.display = 'flex';
}

// Load pinned messages
async function loadPinnedMessages() {
    try {
        const url = currentChatType === 'group' 
            ? `${SERVER_URL}/api/messages/pinned?groupId=${encodeURIComponent(currentGroupId)}`
            : `${SERVER_URL}/api/messages/pinned?from=${encodeURIComponent(username)}&to=${encodeURIComponent(currentChatUser)}`;
        const response = await fetch(url);
        const pinnedMessages = await response.json();
        
        if (pinnedMessages.length === 0) {
            pinnedMessagesList.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-muted);">No pinned messages</p>';
            return;
        }
        
        pinnedMessagesList.innerHTML = pinnedMessages.map(msg => {
            const isSent = msg.from === username;
            const time = new Date(msg.timestamp).toLocaleString();
            let content = '';
            
            if (msg.isVideoMessage) {
                content = `<div class="video-message"><video src="${msg.fileUrl}" preload="metadata"></video><div class="play-overlay">▶</div></div>`;
            } else if (msg.isVoiceMessage) {
                content = `<div class="voice-message ${isSent ? 'sent' : ''}"><div class="voice-play-btn">▶</div><div class="voice-duration">${formatDuration(msg.duration)}</div><audio src="${msg.fileUrl}" preload="metadata"></audio></div>`;
            } else if (msg.fileUrl) {
                content = `<div class="file-message ${isSent ? 'sent' : ''}"><div class="file-icon">📎</div><div class="file-info"><div class="file-name">${escapeHtml(msg.fileName)}</div><div class="file-size">${formatFileSize(msg.fileSize || 0)}</div></div><a href="${msg.fileUrl}" download class="file-download">Download</a></div>`;
            } else {
                content = `<div class="message-bubble">${escapeHtml(msg.message)}</div>`;
            }
            
            return `
                <div class="pinned-message-item" data-message-id="${msg.id}">
                    <div class="message ${isSent ? 'sent' : 'received'}">
                        ${content}
                        <div class="message-info">${time}</div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Add click handlers for pinned messages
        pinnedMessagesList.querySelectorAll('.pinned-message-item').forEach(item => {
            item.addEventListener('click', () => {
                const messageId = item.getAttribute('data-message-id');
                scrollToMessage(messageId);
                pinnedMessagesSection.style.display = 'none';
            });
        });
        
        // Add video/audio play handlers
        pinnedMessagesList.querySelectorAll('.video-message').forEach(videoMsg => {
            const video = videoMsg.querySelector('video');
            const overlay = videoMsg.querySelector('.play-overlay');
            videoMsg.addEventListener('click', () => {
                if (video.paused) {
                    video.play();
                    overlay.style.display = 'none';
                } else {
                    video.pause();
                    overlay.style.display = 'flex';
                }
            });
        });
        
        pinnedMessagesList.querySelectorAll('.voice-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const audio = btn.parentElement.querySelector('audio');
                if (audio.paused) {
                    audio.play();
                    btn.textContent = '⏸';
                } else {
                    audio.pause();
                    btn.textContent = '▶';
                }
            });
        });
    } catch (error) {
        console.error('Error loading pinned messages:', error);
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function scrollToMessage(messageId) {
    const messageElement = messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageElement.style.background = 'var(--active-bg)';
        setTimeout(() => {
            messageElement.style.background = '';
        }, 2000);
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Profile functionality
profileBtn.addEventListener('click', () => {
    loadUserProfile();
    profileModal.style.display = 'flex';
});

closeProfileBtn.addEventListener('click', () => {
    profileModal.style.display = 'none';
});

cancelProfileBtn.addEventListener('click', () => {
    profileModal.style.display = 'none';
});

saveProfileBtn.addEventListener('click', async () => {
    try {
        const displayName = displayNameInput.value.trim();
        const bio = bioInput.value.trim();
        
        const response = await fetch(`${SERVER_URL}/api/users/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, displayName, bio })
        });
        
        const result = await response.json();
        if (result.success) {
            profileModal.style.display = 'none';
            loadCurrentUserProfile();
            showNotification('Profile updated successfully');
        } else {
            showNotification('Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showNotification('Error updating profile', 'error');
    }
});

changeAvatarBtn.addEventListener('click', () => {
    avatarInput.click();
});

avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', username);
    
    try {
        const response = await fetch(`${SERVER_URL}/api/users/avatar`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (result.success) {
            profileAvatar.src = result.avatar;
            loadCurrentUserProfile();
            showNotification('Avatar updated successfully');
        } else {
            showNotification('Failed to update avatar', 'error');
        }
    } catch (error) {
        console.error('Error updating avatar:', error);
        showNotification('Error updating avatar', 'error');
    }
});

deleteAccountBtn.addEventListener('click', () => {
    deleteAccountModal.style.display = 'flex';
});

cancelDeleteBtn.addEventListener('click', () => {
    deleteAccountModal.style.display = 'none';
    deletePasswordInput.value = '';
});

confirmDeleteBtn.addEventListener('click', async () => {
    const password = deletePasswordInput.value;
    if (!password) {
        showNotification('Please enter your password', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/users/${username}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        const result = await response.json();
        if (result.success) {
            sessionStorage.removeItem('username');
            window.location.href = 'index.html';
        } else {
            showNotification(result.error || 'Failed to delete account', 'error');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showNotification('Error deleting account', 'error');
    }
});

// Context menu functionality
document.addEventListener('click', () => {
    messageContextMenu.style.display = 'none';
    userContextMenu.style.display = 'none';
});

deleteMessageBtn.addEventListener('click', async () => {
    if (!selectedMessageId) return;
    
    try {
        const response = await fetch(`/api/messages/${selectedMessageId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const result = await response.json();
        if (result.success) {
            // Remove message from UI
            const messageElement = messagesContainer.querySelector(`[data-message-id="${selectedMessageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
            showNotification('Message deleted');
        } else {
            showNotification(result.error || 'Failed to delete message', 'error');
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        showNotification('Error deleting message', 'error');
    }
    
    messageContextMenu.style.display = 'none';
});

pinMessageBtn.addEventListener('click', async () => {
    if (!selectedMessageId) return;
    
    try {
        const messageElement = messagesContainer.querySelector(`[data-message-id="${selectedMessageId}"]`);
        const isPinned = messageElement.classList.contains('pinned');
        
        const response = await fetch('/api/messages/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: selectedMessageId, pinned: !isPinned })
        });
        
        const result = await response.json();
        if (result.success) {
            messageElement.classList.toggle('pinned');
            loadPinnedMessages();
            showNotification(isPinned ? 'Message unpinned' : 'Message pinned');
        } else {
            showNotification('Failed to pin/unpin message', 'error');
        }
    } catch (error) {
        console.error('Error pinning message:', error);
        showNotification('Error pinning message', 'error');
    }
    
    messageContextMenu.style.display = 'none';
});

blockUserBtn.addEventListener('click', async () => {
    if (!selectedUserForContext) return;
    
    try {
        const response = await fetch('/api/users/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocker: username, blocked: selectedUserForContext })
        });
        
        const result = await response.json();
        if (result.success) {
            showNotification('User blocked');
            loadUserProfile();
            // Reload current chat if it's with the blocked user
            if (currentChatUser === selectedUserForContext) {
                loadMessages();
            }
        } else {
            showNotification(result.error || 'Failed to block user', 'error');
        }
    } catch (error) {
        console.error('Error blocking user:', error);
        showNotification('Error blocking user', 'error');
    }
    
    userContextMenu.style.display = 'none';
});

viewProfileBtn.addEventListener('click', () => {
    // This could open a profile view modal for the selected user
    showNotification('Profile view not implemented yet');
    userContextMenu.style.display = 'none';
});

// Helper functions
async function loadCurrentUserProfile() {
    try {
        const response = await fetch(`/api/users/profile/${username}`);
        const profile = await response.json();
        
        currentUserProfile = profile;
        
        // Update UI
        if (profile.avatar) {
            currentUserAvatar.src = profile.avatar;
            currentUserAvatar.style.display = 'block';
        } else {
            currentUserAvatar.style.display = 'none';
        }
        
        document.getElementById('currentUsername').textContent = profile.displayName || profile.username;
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

async function loadUserProfile() {
    try {
        const response = await fetch(`/api/users/profile/${username}`);
        const profile = await response.json();
        
        // Populate profile modal
        if (profile.avatar) {
            profileAvatar.src = profile.avatar;
        } else {
            profileAvatar.src = '';
        }
        
        displayNameInput.value = profile.displayName || '';
        bioInput.value = profile.bio || '';
        
        // Load blocked users
        const blockedResponse = await fetch(`/api/users/blocked/${username}`);
        const blockedUsers = await blockedResponse.json();
        
        blockedUsersList.innerHTML = blockedUsers.length === 0 
            ? '<div>No blocked users</div>'
            : blockedUsers.map(blockedUser => `
                <div class="blocked-user-item">
                    <span>${blockedUser}</span>
                    <button class="btn-unblock" data-username="${blockedUser}">Unblock</button>
                </div>
            `).join('');
        
        // Add unblock handlers
        blockedUsersList.querySelectorAll('.btn-unblock').forEach(btn => {
            btn.addEventListener('click', async () => {
                const blockedUser = btn.getAttribute('data-username');
                try {
                    const response = await fetch('/api/users/unblock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ blocker: username, blocked: blockedUser })
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        loadUserProfile();
                        showNotification('User unblocked');
                    } else {
                        showNotification('Failed to unblock user', 'error');
                    }
                } catch (error) {
                    console.error('Error unblocking user:', error);
                    showNotification('Error unblocking user', 'error');
                }
            });
        });
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

function showUserContextMenu(x, y) {
    userContextMenu.style.left = x + 'px';
    userContextMenu.style.top = y + 'px';
    userContextMenu.style.display = 'block';
}

function showMessageContextMenu(x, y, messageId) {
    selectedMessageId = messageId;
    messageContextMenu.style.left = x + 'px';
    messageContextMenu.style.top = y + 'px';
    messageContextMenu.style.display = 'block';
}

function showNotification(message, type = 'success') {
    // Simple notification - you could enhance this
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#dc3545' : '#28a745'};
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Load initial contacts on page load
loadInitialContacts();
loadCurrentUserProfile();