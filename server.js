const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;

// Cấu hình phục vụ file tĩnh
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Lấy danh sách IP LAN IPv4 của máy chủ
function getLanIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal) {
                ips.push({ name: devName, address: alias.address });
            }
        }
    }
    return ips;
}

// Lấy link mạng LAN chính
function getPrimaryLanUrl() {
    const ips = getLanIPs();
    if (ips.length > 0) {
        return `http://${ips[0].address}:${PORT}`;
    }
    return `http://localhost:${PORT}`;
}

// Route chính trả về index.html
app.get('/', (req, res) => {
    const publicIndex = path.join(__dirname, 'public', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(publicIndex)) {
        res.sendFile(publicIndex);
    } else if (fs.existsSync(rootIndex)) {
        res.sendFile(rootIndex);
    } else {
        res.send('<h1>LAN Music Office Server is Running</h1>');
    }
});

// API cung cấp thông tin mạng LAN cho Client (QR & Copy Link)
app.get('/api/server-info', (req, res) => {
    const ips = getLanIPs();
    const primaryUrl = getPrimaryLanUrl();
    res.json({
        port: PORT,
        primaryLanUrl: primaryUrl,
        lanList: ips.map((item) => ({
            name: item.name,
            ip: item.address,
            url: `http://${item.address}:${PORT}`
        }))
    });
});

// API tạo mã QR Vector SVG trực tiếp từ server (hoạt động 100% offline không cần CDN)
app.get('/api/qr', async (req, res) => {
    try {
        const targetUrl = req.query.url || getPrimaryLanUrl();
        const svgString = await QRCode.toString(targetUrl, {
            type: 'svg',
            margin: 1,
            width: 280,
            color: {
                dark: '#0f172a',  // Màu đen xanh sang trọng
                light: '#ffffff'  // Nền trắng rõ nét cho camera quét
            }
        });
        res.type('image/svg+xml').send(svgString);
    } catch (err) {
        res.status(500).send('<svg><text>QR Error</text></svg>');
    }
});

// ==========================================
// TRẠNG THÁI HỆ THỐNG (IN-MEMORY STATE)
// ==========================================
const users = new Map();
let adminSocketId = null;

let playlist = [
    {
        id: 'default_1',
        title: 'Lofi Hip Hop Radio - Beats to Relax/Study to',
        artist: 'Lofi Girl',
        url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        youtubeId: 'jfKfPfyJRdk',
        audioUrl: null,
        thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
        duration: 240,
        addedBy: 'Hệ Thống',
        addedById: 'system',
        addedAt: Date.now() - 10000,
        votes: {},
        voteScore: 3
    },
    {
        id: 'default_2',
        title: 'Chillhop Essentials - Relaxing Coffee Vibes',
        artist: 'Chillhop Music',
        url: 'https://www.youtube.com/watch?v=5yx6BWlEVcY',
        youtubeId: '5yx6BWlEVcY',
        audioUrl: null,
        thumbnail: 'https://i.ytimg.com/vi/5yx6BWlEVcY/hqdefault.jpg',
        duration: 210,
        addedBy: 'Hệ Thống',
        addedById: 'system',
        addedAt: Date.now() - 5000,
        votes: {},
        voteScore: 2
    }
];

let currentSong = null;

let playback = {
    isPlaying: false,
    startedAt: 0,
    elapsedAtPause: 0,
    duration: 0
};

function getCurrentPlaybackTime() {
    if (!currentSong) return 0;
    if (!playback.isPlaying) return playback.elapsedAtPause;
    const elapsed = playback.elapsedAtPause + (Date.now() - playback.startedAt) / 1000;
    return Math.min(elapsed, currentSong.duration);
}

function playSong(song) {
    currentSong = song;
    playback.isPlaying = true;
    playback.startedAt = Date.now();
    playback.elapsedAtPause = 0;
    playback.duration = song.duration || 210;

    io.emit('playback:change', {
        currentSong,
        isPlaying: playback.isPlaying,
        currentTime: 0,
        serverTime: Date.now()
    });

    io.emit('chat:system', {
        text: `🎶 Đang phát: "${song.title}" (Yêu cầu bởi: ${song.addedBy})`,
        time: new Date().toLocaleTimeString('vi-VN')
    });
}

function playNextSong() {
    if (playlist.length > 0) {
        const nextSong = playlist.shift();
        playSong(nextSong);
        io.emit('playlist:update', playlist);
    } else {
        currentSong = null;
        playback.isPlaying = false;
        playback.startedAt = 0;
        playback.elapsedAtPause = 0;
        playback.duration = 0;

        io.emit('playback:change', {
            currentSong: null,
            isPlaying: false,
            currentTime: 0,
            serverTime: Date.now()
        });

        io.emit('chat:system', {
            text: '📭 Hàng chờ bài hát đã hết. Hãy thêm bài mới nhé!',
            time: new Date().toLocaleTimeString('vi-VN')
        });
    }
}

if (playlist.length > 0) {
    playSong(playlist.shift());
}

function electNewAdmin(reason = '') {
    const joinedUsers = Array.from(users.values());
    if (joinedUsers.length === 0) {
        adminSocketId = null;
        return null;
    }

    joinedUsers.sort((a, b) => a.joinedAt - b.joinedAt);
    const newAdmin = joinedUsers[0];

    users.forEach((u) => (u.isAdmin = false));
    newAdmin.isAdmin = true;
    adminSocketId = newAdmin.id;

    io.emit('admin:update', {
        adminId: newAdmin.id,
        adminName: newAdmin.username
    });

    io.emit('users:update', {
        count: users.size,
        users: Array.from(users.values())
    });

    io.emit('chat:system', {
        text: `👑 ${newAdmin.username} đã được tự động chỉ định làm Admin mới! ${reason}`,
        time: new Date().toLocaleTimeString('vi-VN')
    });

    return newAdmin;
}

setInterval(() => {
    if (currentSong && playback.isPlaying) {
        const currentTime = getCurrentPlaybackTime();
        if (currentTime >= currentSong.duration) {
            playNextSong();
        }
    }
}, 1000);

setInterval(() => {
    if (currentSong) {
        io.emit('playback:heartbeat', {
            currentSongId: currentSong.id,
            currentTime: getCurrentPlaybackTime(),
            isPlaying: playback.isPlaying,
            serverTime: Date.now()
        });
    }
}, 3000);

function extractYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;

    socket.on('lan:ping', (clientTimestamp, callback) => {
        if (typeof callback === 'function') {
            callback({
                clientTimestamp,
                serverTimestamp: Date.now()
            });
        }
    });

    // 1. NGƯỜI DÙNG THAM GIA VÀO PHÒNG
    socket.on('user:join', (data) => {
        const username = (data && data.username ? data.username.trim() : '') || `Thành viên_${socket.id.substring(0, 4)}`;
        const isFirstUser = users.size === 0 || !adminSocketId;

        const user = {
            id: socket.id,
            username: username,
            joinedAt: Date.now(),
            isAdmin: isFirstUser,
            ip: clientIp
        };

        users.set(socket.id, user);

        if (isFirstUser) {
            adminSocketId = socket.id;
        }

        const ips = getLanIPs();
        const primaryLanUrl = getPrimaryLanUrl();

        // Gửi xác nhận cho chính client kèm thông tin LAN và mã QR
        socket.emit('user:join_ack', {
            currentUser: user,
            adminId: adminSocketId,
            adminName: users.get(adminSocketId)?.username || 'Chưa có',
            currentSong,
            playback: {
                ...playback,
                currentTime: getCurrentPlaybackTime()
            },
            serverTime: Date.now(),
            playlist,
            users: Array.from(users.values()),
            primaryLanUrl: primaryLanUrl,
            lanList: ips.map((item) => ({
                name: item.name,
                ip: item.address,
                url: `http://${item.address}:${PORT}`
            }))
        });

        io.emit('users:update', {
            count: users.size,
            users: Array.from(users.values())
        });

        io.emit('admin:update', {
            adminId: adminSocketId,
            adminName: users.get(adminSocketId)?.username || 'Chưa có'
        });

        io.emit('chat:system', {
            text: `👋 ${user.username} đã tham gia văn phòng!`,
            time: new Date().toLocaleTimeString('vi-VN')
        });
    });

    // 2. CHAT NỘI BỘ
    socket.on('chat:send', (data) => {
        const user = users.get(socket.id);
        const text = data && data.message ? data.message.trim() : '';
        if (!user || !text) return;

        io.emit('chat:message', {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            sender: user.username,
            senderId: user.id,
            isAdmin: user.isAdmin,
            text: text,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // 3. THÊM BÀI HÁT
    socket.on('song:add', (data) => {
        const user = users.get(socket.id);
        const query = data && data.query ? data.query.trim() : '';
        if (!user || !query) return;

        const ytId = extractYouTubeId(query);
        let newSong = null;

        if (ytId) {
            newSong = {
                id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                title: data.title || `YouTube Track [${ytId}]`,
                artist: 'YouTube Video',
                url: query,
                youtubeId: ytId,
                audioUrl: null,
                thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
                duration: 240,
                addedBy: user.username,
                addedById: user.id,
                addedAt: Date.now(),
                votes: { [user.id]: 1 },
                voteScore: 1
            };
        } else {
            const isAudioUrl = query.match(/\.(mp3|wav|ogg|m4a)(\?.*)?$/i);
            newSong = {
                id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                title: query,
                artist: 'Âm thanh văn phòng',
                url: query,
                youtubeId: null,
                audioUrl: isAudioUrl ? query : null,
                thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop&q=80',
                duration: 200,
                addedBy: user.username,
                addedById: user.id,
                addedAt: Date.now(),
                votes: { [user.id]: 1 },
                voteScore: 1
            };
        }

        if (!currentSong) {
            playSong(newSong);
        } else {
            playlist.push(newSong);
            playlist.sort((a, b) => b.voteScore - a.voteScore || a.addedAt - b.addedAt);
            io.emit('playlist:update', playlist);
        }

        io.emit('chat:system', {
            text: `🎵 ${user.username} đã đề xuất: "${newSong.title}"`,
            time: new Date().toLocaleTimeString('vi-VN')
        });
    });

    socket.on('song:update_meta', (data) => {
        if (!data || !data.songId) return;
        if (currentSong && currentSong.id === data.songId) {
            if (data.duration && data.duration > 10) {
                currentSong.duration = Math.round(data.duration);
                playback.duration = currentSong.duration;
            }
            if (data.title && currentSong.title.includes('YouTube Track')) {
                currentSong.title = data.title;
            }
            io.emit('playback:meta_update', {
                songId: currentSong.id,
                title: currentSong.title,
                duration: currentSong.duration
            });
        }
    });

    // 4. VOTE
    socket.on('song:vote', (data) => {
        const user = users.get(socket.id);
        if (!user || !data || !data.songId) return;

        const song = playlist.find((s) => s.id === data.songId);
        if (!song) return;

        const voteType = data.type === -1 ? -1 : 1;

        if (song.votes[user.id] === voteType) {
            delete song.votes[user.id];
        } else {
            song.votes[user.id] = voteType;
        }

        song.voteScore = Object.values(song.votes).reduce((sum, v) => sum + v, 0);
        playlist.sort((a, b) => b.voteScore - a.voteScore || a.addedAt - b.addedAt);

        io.emit('playlist:update', playlist);
    });

    // 5. ĐIỀU KHIỂN PHÁT NHẠC
    socket.on('control:action', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        if (socket.id !== adminSocketId) {
            socket.emit('control:error', {
                message: 'Chỉ Admin mới có quyền điều khiển trình phát chung!'
            });
            return;
        }

        const action = data && data.action;

        switch (action) {
            case 'toggle':
                if (!currentSong) {
                    if (playlist.length > 0) playNextSong();
                    return;
                }
                if (playback.isPlaying) {
                    playback.elapsedAtPause = getCurrentPlaybackTime();
                    playback.isPlaying = false;
                } else {
                    playback.startedAt = Date.now();
                    playback.isPlaying = true;
                }
                io.emit('playback:sync', {
                    isPlaying: playback.isPlaying,
                    currentTime: getCurrentPlaybackTime(),
                    serverTime: Date.now()
                });
                break;

            case 'next':
                playNextSong();
                break;

            case 'prev':
                if (currentSong) {
                    playback.elapsedAtPause = 0;
                    playback.startedAt = Date.now();
                    io.emit('playback:sync', {
                        isPlaying: playback.isPlaying,
                        currentTime: 0,
                        serverTime: Date.now()
                    });
                }
                break;

            case 'seek':
                if (currentSong && typeof data.time === 'number') {
                    const seekTime = Math.max(0, Math.min(data.time, currentSong.duration));
                    playback.elapsedAtPause = seekTime;
                    playback.startedAt = Date.now();
                    io.emit('playback:sync', {
                        isPlaying: playback.isPlaying,
                        currentTime: seekTime,
                        serverTime: Date.now()
                    });
                }
                break;

            default:
                break;
        }
    });

    // 6. NGẮT KẾT NỐI (DISCONNECT)
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (!user) return;

        users.delete(socket.id);

        io.emit('chat:system', {
            text: `🚪 ${user.username} đã rời khỏi văn phòng.`,
            time: new Date().toLocaleTimeString('vi-VN')
        });

        if (socket.id === adminSocketId) {
            electNewAdmin(`(do Admin ${user.username} đã mất kết nối)`);
        } else {
            io.emit('users:update', {
                count: users.size,
                users: Array.from(users.values())
            });
        }
    });
});

// ==========================================
// KHỞI CHẠY SERVER TRÊN MẠNG LAN
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanIPs();
    console.log('\n======================================================');
    console.log('   🎧 LAN MUSIC OFFICE - SERVER REALTIME ONLINE');
    console.log('======================================================');
    console.log(`> Truy cập cục bộ: http://localhost:${PORT}`);
    if (lanIps.length > 0) {
        console.log('> Chia sẻ cho đồng nghiệp trong mạng LAN:');
        lanIps.forEach((item) => {
            console.log(`   👉 http://${item.address}:${PORT}  (${item.name})`);
        });
    } else {
        console.log(`> Địa chỉ mạng: http://0.0.0.0:${PORT}`);
    }
    console.log('------------------------------------------------------');
    console.log('* Mã QR & API chia sẻ: http://localhost:' + PORT + '/api/qr');
    console.log('* Tính năng: Time-Sync, Auto Admin Failover, Vote Playlist, QR Code');
    console.log('======================================================\n');
});
