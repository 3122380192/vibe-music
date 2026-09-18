const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

// Tự động nạp file .env nếu có
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = (match[2] || '').trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                if (!process.env[key]) process.env[key] = value;
            }
        });
    } catch(e) {}
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;
let globalOnlineUrl = process.env.PUBLIC_URL || null;

// Body parser cho webhook và REST API
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình phục vụ file tĩnh (ưu tiên public/)
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

function getPrimaryLanUrl() {
    if (globalOnlineUrl) return globalOnlineUrl;
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    const ips = getLanIPs();
    if (ips.length > 0) {
        return `http://${ips[0].address}:${PORT}`;
    }
    return `http://localhost:${PORT}`;
}

app.get('/', (req, res) => {
    const publicIndex = path.join(__dirname, 'public', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(publicIndex)) {
        res.sendFile(publicIndex);
    } else if (fs.existsSync(rootIndex)) {
        res.sendFile(rootIndex);
    } else {
        res.send('<h1>LAN Music Office & Game Zone Server is Running</h1>');
    }
});

app.get('/api/server-info', (req, res) => {
    const ips = getLanIPs();
    const primaryUrl = getPrimaryLanUrl();
    res.json({
        port: PORT,
        primaryLanUrl: primaryUrl,
        onlineUrl: globalOnlineUrl,
        lanList: ips.map((item) => ({
            name: item.name,
            ip: item.address,
            url: `http://${item.address}:${PORT}`
        }))
    });
});

app.get('/api/qr', async (req, res) => {
    try {
        const targetUrl = req.query.url || globalOnlineUrl || getPrimaryLanUrl();
        const svgString = await QRCode.toString(targetUrl, {
            type: 'svg',
            margin: 1,
            width: 280,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });
        res.type('image/svg+xml').send(svgString);
    } catch (err) {
        res.status(500).send('<svg><text>QR Error</text></svg>');
    }
});

// API nhận diện metadata bài hát nhanh
app.get('/api/song-meta', async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        if (!query) return res.json({ success: false, message: 'Chưa có thông tin tìm kiếm' });

        let ytId = extractYouTubeId(query);
        if (!ytId) {
            ytId = await searchYouTube(query);
        }

        if (ytId) {
            const meta = await fetchYouTubeMeta(ytId);
            return res.json({
                success: true,
                youtubeId: ytId,
                title: meta.title,
                artist: meta.artist,
                thumbnail: meta.thumbnail,
                url: `https://www.youtube.com/watch?v=${ytId}`
            });
        }
        res.json({ success: false, message: 'Không tìm thấy bài hát phù hợp' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// REST API CHO TELEGRAM BOT & WEBHOOKS
// ==========================================
app.get('/api/bot/random', async (req, res) => {
    try {
        const by = req.query.by || 'Bot @HiFiAudiobot';
        const playNow = req.query.playNow === 'true' || req.query.playNow === '1';
        let song;
        if (playNow || !currentSong) {
            song = await playRandomSongDirectly(by);
        } else {
            song = await queueRandomSong(by);
        }
        if (song) {
            res.json({ success: true, song, playedImmediately: playNow || !currentSong });
        } else {
            res.status(500).json({ success: false, message: 'Không thể thêm bài ngẫu nhiên lúc này' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/bot/add-song', async (req, res) => {
    try {
        const { query, title, artist, audioUrl, addedBy } = req.body;
        if (!query && !audioUrl) {
            return res.status(400).json({ success: false, message: 'Thiếu query hoặc audioUrl' });
        }
        const song = await addSongFromSource(query, title, artist, audioUrl, addedBy || 'Bot @HiFiAudiobot');
        if (song) {
            res.json({ success: true, song });
        } else {
            res.status(404).json({ success: false, message: 'Không tìm thấy bài hát' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/bot/status', (req, res) => {
    res.json({
        success: true,
        botConnected: isTelegramPolling,
        botInfo: telegramBotInfo,
        currentSong,
        playlistCount: playlist.length,
        isPlaying: playback.isPlaying,
        onlineUrl: globalOnlineUrl
    });
});

app.post('/api/bot/set-token', (req, res) => {
    const { token, chatId } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token không được để trống' });
    if (chatId) telegramTargetChatId = chatId.trim();
    startTelegramBot(token);
    res.json({ success: true, message: 'Đang kết nối bot Telegram...' });
});

// Streaming Audio Proxy cho Telegram Audio Files (bảo mật bot token & hỗ trợ Range tua nhạc)
app.get('/api/telegram-audio', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !telegramBotToken) {
        return res.status(400).send('Thiếu path hoặc chưa cấu hình Telegram Bot Token');
    }
    const tgUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${filePath}`;
    
    const requestHeaders = {};
    if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range;
    }

    https.get(tgUrl, { headers: requestHeaders }, (tgRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        if (tgRes.headers['content-type']) {
            res.setHeader('Content-Type', tgRes.headers['content-type']);
        } else {
            res.setHeader('Content-Type', 'audio/mpeg');
        }
        if (tgRes.headers['content-length']) {
            res.setHeader('Content-Length', tgRes.headers['content-length']);
        }
        if (tgRes.headers['content-range']) {
            res.setHeader('Content-Range', tgRes.headers['content-range']);
        }
        res.status(tgRes.statusCode || 200);
        tgRes.pipe(res);
    }).on('error', (err) => {
        console.warn('Audio stream proxy error:', err.message);
        if (!res.headersSent) res.status(500).send('Lỗi tải stream âm thanh: ' + err.message);
    });
});

// ==========================================
// TRẠNG THÁI PHÒNG NHẠC (MUSIC STATE)
// ==========================================
const users = new Map(); // socket.id => { id, username, joinedAt, isAdmin, ip, coins, gamesWon, gamesPlayed }
let adminSocketId = null;

let playlist = [
    {
        id: 'default_1',
        title: 'Nàng Thơ',
        artist: 'Hoàng Dũng',
        url: 'https://www.youtube.com/watch?v=Zzn9-ATB9aU',
        youtubeId: 'Zzn9-ATB9aU',
        audioUrl: null,
        thumbnail: 'https://i.ytimg.com/vi/Zzn9-ATB9aU/hqdefault.jpg',
        duration: 254,
        addedBy: 'Hệ Thống',
        addedById: 'system',
        addedAt: Date.now() - 10000,
        votes: {},
        voteScore: 3
    },
    {
        id: 'default_2',
        title: 'Chillhop Radio - Jazzy & Lofi Hip Hop Beats',
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
    },
    {
        id: 'default_3',
        title: 'Snowman',
        artist: 'Sia',
        url: 'https://www.youtube.com/watch?v=gset79KMmt0',
        youtubeId: 'gset79KMmt0',
        audioUrl: null,
        thumbnail: 'https://i.ytimg.com/vi/gset79KMmt0/hqdefault.jpg',
        duration: 170,
        addedBy: 'Hệ Thống',
        addedById: 'system',
        addedAt: Date.now() - 2000,
        votes: {},
        voteScore: 1
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
    if (!song) return;
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

let lastSongSkipTime = 0;

async function playRandomSongDirectly(requestedBy = 'Hệ Thống (Auto DJ)') {
    const track = RANDOM_CURATED_TRACKS[Math.floor(Math.random() * RANDOM_CURATED_TRACKS.length)];
    let ytId = track.youtubeId || (track.query ? extractYouTubeId(track.query) : null);
    if (!ytId && track.query) {
        ytId = await searchYouTube(track.query);
    }
    if (!ytId) ytId = 'Zzn9-ATB9aU'; // Fallback Nàng Thơ

    const meta = await fetchYouTubeMeta(ytId);
    const newSong = {
        id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: track.title || meta.title,
        artist: track.artist || meta.artist,
        url: `https://www.youtube.com/watch?v=${ytId}`,
        youtubeId: ytId,
        audioUrl: null,
        thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        duration: 240,
        addedBy: requestedBy,
        addedById: 'bot',
        addedAt: Date.now(),
        votes: {},
        voteScore: 1
    };

    playSong(newSong);
    return newSong;
}

async function playNextSong(forceSkip = false) {
    const now = Date.now();
    if (!forceSkip && now - lastSongSkipTime < 1500) {
        return; // Tránh spam skip khi nhiều client báo bài kết thúc cùng lúc
    }
    lastSongSkipTime = now;

    if (playlist.length > 0) {
        const nextSong = playlist.shift();
        playSong(nextSong);
        io.emit('playlist:update', playlist);
    } else {
        // Tự động phát ngay 1 bài ngẫu nhiên từ kho curated để phòng luôn có nhạc
        await playRandomSongDirectly('Hệ Thống (Auto DJ)');
    }
}

if (playlist.length > 0) {
    playSong(playlist.shift());
}


// ==========================================
// KHO NHẠC RANDOM & HỖ TRỢ BOT TELEGRAM
// ==========================================
const RANDOM_CURATED_TRACKS = [
    { title: "Nàng Thơ", artist: "Hoàng Dũng", youtubeId: "Zzn9-ATB9aU", query: "Nàng Thơ Hoàng Dũng" },
    { title: "Ghé Qua", artist: "Dick x PC x Tofu", youtubeId: "zEWSSod0zTY", query: "Ghé Qua Dick PC Tofu" },
    { title: "Từng Là", artist: "Vũ Cát Tường", youtubeId: "i4qZmKSFYvI", query: "Từng Là Vũ Cát Tường" },
    { title: "Lạ Lùng", artist: "Vũ.", youtubeId: "F5tS5m86bOI", query: "Lạ Lùng Vũ" },
    { title: "Một Đêm Say", artist: "Thịnh Suy", youtubeId: "Csuk1Wm5W0E", query: "Một Đêm Say Thịnh Suy" },
    { title: "Đi Về Nhà", artist: "Đen x JustaTee", youtubeId: "vTJdVE_gjI0", query: "Đi Về Nhà Đen JustaTee" },
    { title: "Bài Này Chill Phết", artist: "Đen ft. MIN", youtubeId: "ddaEtFOsFeM", query: "Bài Này Chill Phết Đen MIN" },
    { title: "Snowman", artist: "Sia", youtubeId: "gset79KMmt0", query: "Snowman Sia" },
    { title: "Attention", artist: "Charlie Puth", youtubeId: "nfs8NYg7yQM", query: "Attention Charlie Puth" },
    { title: "Golden Hour", artist: "JVKE", youtubeId: "PEM0Vs8jf1w", query: "Golden Hour JVKE" },
    { title: "Chillhop Radio - Jazzy Lofi", artist: "Chillhop Music", youtubeId: "5yx6BWlEVcY", query: "Chillhop Radio Jazzy Lofi" },
    { title: "Chuyện Đôi Ta", artist: "Emcee L ft Muộii", youtubeId: "1eE96p16C7w", query: "Chuyện Đôi Ta Emcee L" },
    { title: "Ánh Sao Và Bầu Trời", artist: "T.R.I", youtubeId: "w2d_B4g8lD4", query: "Ánh Sao Và Bầu Trời T.R.I" }
];

async function addSongFromSource(query, title = null, artist = null, audioUrl = null, addedBy = 'Bot @HiFiAudiobot') {
    let ytId = query ? extractYouTubeId(query) : null;
    const isAudioUrl = audioUrl || (query && query.match(/\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/i));
    let newSong = null;

    if (!ytId && !isAudioUrl && query) {
        ytId = await searchYouTube(query);
    }

    if (ytId) {
        const meta = await fetchYouTubeMeta(ytId);
        newSong = {
            id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            title: title || meta.title,
            artist: artist || meta.artist,
            url: `https://www.youtube.com/watch?v=${ytId}`,
            youtubeId: ytId,
            audioUrl: null,
            thumbnail: meta.thumbnail,
            duration: 240,
            addedBy: addedBy,
            addedById: 'bot',
            addedAt: Date.now(),
            votes: {},
            voteScore: 1
        };
    } else if (isAudioUrl || audioUrl) {
        const directUrl = audioUrl || query;
        newSong = {
            id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            title: title || directUrl.split('/').pop().split('?')[0] || 'Hi-Fi Audio Track',
            artist: artist || 'HiFi Audio Stream',
            url: directUrl,
            youtubeId: null,
            audioUrl: directUrl,
            thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop&q=80',
            duration: 220,
            addedBy: addedBy,
            addedById: 'bot',
            addedAt: Date.now(),
            votes: {},
            voteScore: 1
        };
    } else {
        return null;
    }

    if (!currentSong) {
        playSong(newSong);
    } else {
        playlist.push(newSong);
        playlist.sort((a, b) => b.voteScore - a.voteScore || a.addedAt - b.addedAt);
        io.emit('playlist:update', playlist);
    }

    io.emit('chat:system', {
        text: `🤖 ${addedBy} đã thêm: "${newSong.title}" (${newSong.artist})`,
        time: new Date().toLocaleTimeString('vi-VN')
    });

    return newSong;
}

async function queueRandomSong(requestedBy = 'Bot @HiFiAudiobot') {
    const track = RANDOM_CURATED_TRACKS[Math.floor(Math.random() * RANDOM_CURATED_TRACKS.length)];
    let ytId = track.youtubeId || (track.query ? extractYouTubeId(track.query) : null);
    if (!ytId && track.query) {
        ytId = await searchYouTube(track.query);
    }
    if (!ytId) ytId = 'Zzn9-ATB9aU';
    return await addSongFromSource(track.query || `https://www.youtube.com/watch?v=${ytId}`, track.title, track.artist, null, requestedBy);
}

// ==========================================
// TÍCH HỢP TELEGRAM BOT (@HiFiAudiobot & Group Bridge)
// ==========================================
const DEFAULT_TELEGRAM_TOKEN = '8853363855:AAF5cNwYh9Dj3JprWrvh5eZ6kESZJ-ECMuI';
const DEFAULT_TELEGRAM_CHAT_ID = '-5022971494';

let telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_TOKEN;
let telegramTargetChatId = process.env.TELEGRAM_CHAT_ID || DEFAULT_TELEGRAM_CHAT_ID;

const telegramArgIdx = process.argv.indexOf('--telegram');
if (telegramArgIdx !== -1 && process.argv[telegramArgIdx + 1]) {
    telegramBotToken = process.argv[telegramArgIdx + 1];
}
const chatArgIdx = process.argv.indexOf('--chat');
if (chatArgIdx !== -1 && process.argv[chatArgIdx + 1]) {
    telegramTargetChatId = process.argv[chatArgIdx + 1];
}

let telegramBotInfo = null;
let isTelegramPolling = false;
let lastTelegramUpdateId = 0;

async function sendTelegramMessage(chatId, text, replyToMessageId = null) {
    if (!telegramBotToken) return;
    try {
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                reply_to_message_id: replyToMessageId,
                parse_mode: 'HTML',
                disable_web_page_preview: false
            })
        });
    } catch(e) {
        console.warn('Telegram send error:', e.message);
    }
}

async function startTelegramBot(token) {
    if (!token) return;
    telegramBotToken = token.trim();
    if (isTelegramPolling) return;
    isTelegramPolling = true;

    try {
        const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getMe`);
        const data = await res.json();
        if (data.ok) {
            telegramBotInfo = data.result;
            console.log(`🤖 Telegram Bot đã kết nối thành công: @${telegramBotInfo.username} (${telegramBotInfo.first_name})`);
            io.emit('telegram:status', { connected: true, botInfo: telegramBotInfo });

            // Thông báo kết nối thành công tới nhóm chat mục tiêu (-5022971494)
            if (telegramTargetChatId) {
                sendTelegramMessage(telegramTargetChatId, `🟢 <b>LAN MUSIC BOT ĐÃ SẴN SÀNG!</b>\n` +
                    `🎵 Bot <b>@${telegramBotInfo.username}</b> đã kết nối thành công với phòng nghe nhạc!\n` +
                    `👉 Gõ <code>/random</code> để chọn ngẫu nhiên bài chill\n` +
                    `👉 Gõ <code>/play [tên bài hát]</code> để phát nhạc\n` +
                    `👉 Chuyển tiếp (forward) hoặc thả file nhạc từ <b>@HiFiAudiobot</b> vào nhóm để phát trực tiếp!\n` +
                    `🌐 <b>Link phòng:</b> ${globalOnlineUrl || getPrimaryLanUrl()}`);
            }

            pollTelegramUpdates();
        } else {
            console.warn('❌ Token Telegram không hợp lệ:', data.description);
            isTelegramPolling = false;
            io.emit('telegram:status', { connected: false, error: data.description });
        }
    } catch(e) {
        console.warn('❌ Không thể kết nối tới Telegram API:', e.message);
        isTelegramPolling = false;
    }
}

async function pollTelegramUpdates() {
    if (!isTelegramPolling || !telegramBotToken) return;
    try {
        const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=20`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
                lastTelegramUpdateId = update.update_id;
                await handleTelegramMessage(update.message || update.channel_post || update.edited_message);
            }
        }
    } catch(err) {
        // Long polling timeout or transient network issue
    }
    if (isTelegramPolling) {
        setTimeout(pollTelegramUpdates, 1000);
    }
}

async function handleTelegramMessage(msg) {
    if (!msg) return;
    const chatId = msg.chat.id;
    const sender = msg.from ? (msg.from.first_name || msg.from.username || 'Người dùng Telegram') : 'Telegram';
    let text = (msg.text || msg.caption || '').trim();

    // 1. Nhận diện tệp âm thanh (Audio / Voice / Document MP3/FLAC/M4A từ @HiFiAudiobot hoặc thành viên)
    const isAudioDoc = msg.document && (
        (msg.document.mime_type && msg.document.mime_type.startsWith('audio/')) ||
        (msg.document.file_name && msg.document.file_name.match(/\.(mp3|flac|wav|m4a|aac|ogg|opus)$/i))
    );

    if (msg.audio || isAudioDoc || msg.voice) {
        const audioObj = msg.audio || msg.document || msg.voice;
        const fileId = audioObj.file_id;
        let songTitle = audioObj.title || audioObj.file_name;
        if (!songTitle && msg.caption) songTitle = msg.caption.split('\n')[0].trim();
        if (!songTitle) songTitle = 'Bản nhạc Hi-Fi Audio';
        const songArtist = audioObj.performer || (msg.forward_from?.username ? `@${msg.forward_from.username}` : (msg.from?.is_bot ? `@${msg.from.username}` : 'HiFi Audio'));
        const duration = audioObj.duration || 220;

        try {
            const fileRes = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            if (fileData.ok && fileData.result.file_path) {
                // Sử dụng Stream Proxy nội bộ để đảm bảo CORS và không lộ token bot ra web client
                const streamUrl = `/api/telegram-audio?path=${encodeURIComponent(fileData.result.file_path)}`;
                const senderTag = msg.forward_from ? `Forward từ @${msg.forward_from.username || msg.forward_from.first_name}` : (msg.from?.is_bot ? `@${msg.from.username}` : sender);
                
                const added = await addSongFromSource(null, songTitle, songArtist, streamUrl, `Telegram (${senderTag})`);
                if (added) {
                    await sendTelegramMessage(chatId, `🎧 <b>ĐÃ NHẬN NHẠC TỪ TELEGRAM / @HiFiAudiobot!</b>\n\n` +
                        `🎵 <b>Bài hát:</b> ${added.title}\n` +
                        `👤 <b>Nghệ sĩ:</b> ${added.artist}\n` +
                        `⏱ <b>Thời lượng:</b> ~${Math.round(duration)}s\n` +
                        `✅ <i>Đã đưa vào phòng phát nhạc LAN & Online!</i>\n` +
                        `🌐 <a href="${globalOnlineUrl || getPrimaryLanUrl()}">Vào phòng nghe ngay</a>`, msg.message_id);
                }
            } else {
                if (fileData.description && fileData.description.includes('too big')) {
                    await sendTelegramMessage(chatId, `⚠️ <b>Tệp âm thanh vượt quá giới hạn 20MB!</b>\nTelegram Bot API giới hạn tải file tối đa 20MB. Bạn hãy chọn bản MP3 320kbps thay vì FLAC gốc hoặc gửi link bài hát để phát nhé!`, msg.message_id);
                } else {
                    await sendTelegramMessage(chatId, `⚠️ Không thể tải tệp âm thanh: ${fileData.description || 'Lỗi Telegram API'}`, msg.message_id);
                }
            }
        } catch(err) {
            await sendTelegramMessage(chatId, `⚠️ Lỗi xử lý file âm thanh: ${err.message}`, msg.message_id);
        }
        return;
    }

    if (!text) return;

    // Chuẩn hóa câu lệnh: xóa đuôi @username_bot (ví dụ: /random@MyMusicBridgeBot -> /random)
    let cleanText = text;
    if (telegramBotInfo && telegramBotInfo.username) {
        cleanText = cleanText.replace(new RegExp(`@${telegramBotInfo.username}`, 'gi'), '');
    }
    cleanText = cleanText.trim();

    // 2. Nhận diện trực tiếp link YouTube dán trong nhóm (không cần gõ /play)
    const ytMatch = extractYouTubeId(cleanText);
    if (ytMatch && !cleanText.startsWith('/')) {
        const added = await addSongFromSource(cleanText, null, null, null, `Telegram (${sender})`);
        if (added) {
            await sendTelegramMessage(chatId, `🎬 <b>ĐÃ NHẬN LINK YOUTUBE TỪ TELEGRAM!</b>\n\n` +
                `🎵 <b>Bài hát:</b> ${added.title}\n` +
                `👤 <b>Kênh / Nghệ sĩ:</b> ${added.artist}\n` +
                `✅ Đã đưa vào danh sách phát phòng nhạc!\n` +
                `🌐 <a href="${globalOnlineUrl || getPrimaryLanUrl()}">Vào phòng nghe ngay</a>`, msg.message_id);
        }
        return;
    }

    // 3. Lệnh /random hoặc các từ khóa ngẫu nhiên
    const lowerText = cleanText.toLowerCase();
    if (cleanText.startsWith('/random') || cleanText.startsWith('/rd') || cleanText.startsWith('/playrandom') || lowerText === 'random' || lowerText === 'rd' || lowerText === 'bài khác' || lowerText === 'nhạc ngẫu nhiên' || lowerText === 'bật bài ngẫu nhiên') {
        const isNow = cleanText.includes('now') || cleanText.includes('ngay') || cleanText.startsWith('/playrandom');
        let randomSong;
        if (isNow || !currentSong) {
            randomSong = await playRandomSongDirectly(`Telegram (${sender})`);
        } else {
            randomSong = await queueRandomSong(`Telegram (${sender})`);
        }

        if (randomSong) {
            await sendTelegramMessage(chatId, `🎲 <b>ĐÃ CHỌN NGẪU NHIÊN BÀI HÁT:</b>\n\n` +
                `🎵 <b>${randomSong.title}</b>\n` +
                `👤 <b>${randomSong.artist}</b>\n` +
                `👉 <i>${isNow ? '🔥 ĐANG PHÁT NGAY TRÊN HỆ THỐNG!' : (currentSong && currentSong.id === randomSong.id ? '🔥 Đang phát ngay!' : '📋 Đã đưa vào danh sách chờ!')}</i>\n` +
                `🌐 <a href="${globalOnlineUrl || getPrimaryLanUrl()}">Vào phòng nghe ngay</a>`, msg.message_id);
        }
        return;
    }

    // 4. Lệnh /play <tên bài hoặc link>
    if (cleanText.startsWith('/play')) {
        const query = cleanText.replace(/^\/play\s*/i, '').trim();
        if (query) {
            await sendTelegramMessage(chatId, `🔍 Đang tìm kiếm bài hát: "<b>${query}</b>"...`, msg.message_id);
            const added = await addSongFromSource(query, null, null, null, `Telegram (${sender})`);
            if (added) {
                await sendTelegramMessage(chatId, `✅ <b>ĐÃ THÊM BÀI HÁT VÀO PHÒNG:</b>\n\n` +
                    `🎵 <b>${added.title}</b>\n` +
                    `👤 <b>${added.artist}</b>\n` +
                    `⏱ Thời lượng: ~${Math.round(added.duration)}s\n` +
                    `🌐 <a href="${globalOnlineUrl || getPrimaryLanUrl()}">Vào phòng nghe ngay</a>`, msg.message_id);
            } else {
                await sendTelegramMessage(chatId, `❌ Không tìm thấy bài hát phù hợp với từ khóa "<b>${query}</b>"!`, msg.message_id);
            }
        } else {
            await sendTelegramMessage(chatId, `💡 <b>Hướng dẫn:</b> Hãy gõ <code>/play tên bài hát</code> (Ví dụ: <code>/play Nàng Thơ Hoàng Dũng</code>)`, msg.message_id);
        }
        return;
    }

    // 5. Lệnh /skip hoặc /next hoặc chuyển bài
    if (cleanText.startsWith('/skip') || cleanText.startsWith('/next') || cleanText.startsWith('/chuyenbai') || lowerText === 'skip' || lowerText === 'next' || lowerText === 'chuyển bài' || lowerText === 'bỏ qua' || lowerText === 'đổi bài') {
        await playNextSong(true);
        await sendTelegramMessage(chatId, `⏭️ <b>Đã bỏ qua bài hát!</b> Đang phát bài tiếp theo...`, msg.message_id);
        return;
    }

    // 6. Lệnh /queue hoặc /np (Now Playing) hoặc /list
    if (cleanText.startsWith('/queue') || cleanText.startsWith('/np') || cleanText.startsWith('/list')) {
        let reply = `🎧 <b>Đang phát:</b> ${currentSong ? `<b>${currentSong.title}</b> (${currentSong.artist})` : 'Chưa có bài nào'}\n\n`;
        reply += `📋 <b>Hàng chờ (${playlist.length} bài):</b>\n`;
        if (playlist.length === 0) {
            reply += `<i>(Trống - Gõ /random để bot chọn bài ngẫu nhiên!)</i>`;
        } else {
            playlist.slice(0, 5).forEach((s, idx) => {
                reply += `${idx + 1}. <b>${s.title}</b> (${s.artist})\n`;
            });
            if (playlist.length > 5) reply += `<i>... và ${playlist.length - 5} bài khác.</i>`;
        }
        await sendTelegramMessage(chatId, reply, msg.message_id);
        return;
    }

    // 7. Lệnh /link hoặc /web hoặc /room
    if (cleanText.startsWith('/link') || cleanText.startsWith('/web') || cleanText.startsWith('/room')) {
        const lan = getPrimaryLanUrl();
        const online = globalOnlineUrl;
        let reply = `🌐 <b>LIÊN KẾT PHÒNG NHẠC:</b>\n\n`;
        reply += `📶 <b>Mạng Nội Bộ (LAN/WiFi):</b>\n<code>${lan}</code>\n\n`;
        if (online) {
            reply += `🌍 <b>Online Toàn Cầu (Internet/4G):</b>\n<code>${online}</code>\n\n`;
        }
        reply += `👥 <b>Thành viên online:</b> ${users.size} người`;
        await sendTelegramMessage(chatId, reply, msg.message_id);
        return;
    }

    // 8. Lệnh /start hoặc /help
    if (cleanText.startsWith('/start') || cleanText.startsWith('/help')) {
        const helpText = `🤖 <b>Xin chào ${sender}!</b>\n` +
            `Tôi là Bot điều khiển âm nhạc cho <b>LAN Music Office & Game Zone</b>.\n\n` +
            `👉 <b>Các lệnh điều khiển:</b>\n` +
            `• <code>/random</code> : Chọn ngẫu nhiên bài hát hay vào phòng\n` +
            `• <code>/play [tên bài hát hoặc link]</code> : Thêm bài hát bất kỳ\n` +
            `• <code>/skip</code> : Bỏ qua bài hát hiện tại\n` +
            `• <code>/queue</code> : Xem danh sách bài hát đang chờ\n` +
            `• <code>/link</code> : Lấy link vào phòng nghe nhạc\n` +
            `• <i>Gửi hoặc chuyển tiếp (Forward) file MP3/FLAC từ @HiFiAudiobot vào đây để phát trực tiếp!</i>\n\n` +
            `🌐 <b>Link phòng nhạc:</b> ${globalOnlineUrl || getPrimaryLanUrl()}`;
        await sendTelegramMessage(chatId, helpText, msg.message_id);
    }
}

// Khởi động bot ngay khi máy chủ chạy
if (telegramBotToken) {
    startTelegramBot(telegramBotToken);
}


function electNewAdmin(reason = '') {
    const joinedUsers = Array.from(users.values());
    if (joinedUsers.length === 0) {
        adminSocketId = null;
        return null;
    }

    // Ưu tiên user tên "TX" nếu có
    const txUser = joinedUsers.find(u => u.username.toUpperCase() === 'TX');
    let newAdmin = txUser;

    if (!newAdmin) {
        joinedUsers.sort((a, b) => a.joinedAt - b.joinedAt);
        newAdmin = joinedUsers[0];
    }

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
        text: `👑 ${newAdmin.username} đã được chỉ định làm Admin phòng! ${reason}`,
        time: new Date().toLocaleTimeString('vi-VN')
    });

    return newAdmin;
}

// Playback timers
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

function extractYouTubeId(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    urlStr = urlStr.trim();
    try {
        const parsed = new URL(urlStr);
        if (parsed.hostname.includes('youtube.com')) {
            if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
            if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
            if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2];
            if (parsed.pathname.startsWith('/v/')) return parsed.pathname.split('/')[2];
        }
        if (parsed.hostname.includes('youtu.be')) {
            const id = parsed.pathname.slice(1).split('/')[0].split('?')[0];
            if (id && id.length === 11) return id;
        }
    } catch(e) {}
    const match = urlStr.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlStr)) return urlStr;
    return null;
}

async function searchYouTube(query) {
    try {
        const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'vi,en;q=0.9'
            }
        });
        const html = await res.text();
        const m1 = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (m1) return m1[1];
        const m2 = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        if (m2) return m2[1];
    } catch(e) {}
    return null;
}

async function fetchYouTubeMeta(ytId) {
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
        if (res.ok) {
            const data = await res.json();
            return {
                title: data.title || `YouTube Track [${ytId}]`,
                artist: data.author_name || 'YouTube Video',
                thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
            };
        }
    } catch(e) {}
    try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId}`);
        if (res.ok) {
            const data = await res.json();
            return {
                title: data.title || `YouTube Track [${ytId}]`,
                artist: data.author_name || 'YouTube Video',
                thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
            };
        }
    } catch(e) {}
    return {
        title: `YouTube Track [${ytId}]`,
        artist: 'YouTube Video',
        thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
    };
}

// ==========================================
// CỜ TƯỚNG INITIALIZATION & RULES
// ==========================================
function initChineseChessBoard() {
    const b = Array(90).fill(null);
    // Black pieces (Hàng 0-35)
    b[0] = { name: '車', side: 'black' };
    b[1] = { name: '馬', side: 'black' };
    b[2] = { name: '象', side: 'black' };
    b[3] = { name: '士', side: 'black' };
    b[4] = { name: '將', side: 'black' };
    b[5] = { name: '士', side: 'black' };
    b[6] = { name: '象', side: 'black' };
    b[7] = { name: '馬', side: 'black' };
    b[8] = { name: '車', side: 'black' };
    b[19] = { name: '砲', side: 'black' };
    b[25] = { name: '砲', side: 'black' };
    b[27] = { name: '卒', side: 'black' };
    b[29] = { name: '卒', side: 'black' };
    b[31] = { name: '卒', side: 'black' };
    b[33] = { name: '卒', side: 'black' };
    b[35] = { name: '卒', side: 'black' };

    // Red pieces (Hàng 54-89)
    b[81] = { name: '俥', side: 'red' };
    b[82] = { name: '傌', side: 'red' };
    b[83] = { name: '相', side: 'red' };
    b[84] = { name: '仕', side: 'red' };
    b[85] = { name: '帥', side: 'red' };
    b[86] = { name: '仕', side: 'red' };
    b[87] = { name: '相', side: 'red' };
    b[88] = { name: '傌', side: 'red' };
    b[89] = { name: '俥', side: 'red' };
    b[64] = { name: '炮', side: 'red' };
    b[70] = { name: '炮', side: 'red' };
    b[54] = { name: '兵', side: 'red' };
    b[56] = { name: '兵', side: 'red' };
    b[58] = { name: '兵', side: 'red' };
    b[60] = { name: '兵', side: 'red' };
    b[62] = { name: '兵', side: 'red' };

    return b;
}

function validateCoTuongMove(board, from, to) {
    if (from === to) return false;
    const piece = board[from];
    if (!piece) return false;

    const target = board[to];
    if (target && target.side === piece.side) return false;

    const r1 = Math.floor(from / 9), c1 = from % 9;
    const r2 = Math.floor(to / 9), c2 = to % 9;
    const dr = r2 - r1;
    const dc = c2 - c1;
    const absDr = Math.abs(dr);
    const absDc = Math.abs(dc);
    const name = piece.name;
    const side = piece.side;

    // Tướng (帥 / 將)
    if (name === '帥' || name === '將') {
        if (c2 < 3 || c2 > 5) return false;
        if (side === 'red' && (r2 < 7 || r2 > 9)) return false;
        if (side === 'black' && (r2 < 0 || r2 > 2)) return false;
        if ((absDr === 1 && absDc === 0) || (absDr === 0 && absDc === 1)) return true;
        // Chiếu tướng trực diện
        if (c1 === c2 && target && (target.name === '帥' || target.name === '將')) {
            const minR = Math.min(r1, r2);
            const maxR = Math.max(r1, r2);
            let blocked = false;
            for (let r = minR + 1; r < maxR; r++) {
                if (board[r * 9 + c1] !== null) { blocked = true; break; }
            }
            if (!blocked) return true;
        }
        return false;
    }

    // Sĩ (仕 / 士)
    if (name === '仕' || name === '士') {
        if (c2 < 3 || c2 > 5) return false;
        if (side === 'red' && (r2 < 7 || r2 > 9)) return false;
        if (side === 'black' && (r2 < 0 || r2 > 2)) return false;
        if (absDr === 1 && absDc === 1) return true;
        return false;
    }

    // Tượng (相 / 象)
    if (name === '相' || name === '象') {
        if (side === 'red' && r2 < 5) return false; // Không qua sông
        if (side === 'black' && r2 > 4) return false;
        if (absDr === 2 && absDc === 2) {
            const midR = r1 + dr / 2;
            const midC = c1 + dc / 2;
            if (board[midR * 9 + midC] === null) return true; // Không bị cản mắt tượng
        }
        return false;
    }

    // Mã (傌 / 馬)
    if (name === '傌' || name === '馬') {
        if ((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)) {
            let legR = r1;
            let legC = c1;
            if (absDr === 2) legR = r1 + (dr > 0 ? 1 : -1);
            else legC = c1 + (dc > 0 ? 1 : -1);
            if (board[legR * 9 + legC] === null) return true; // Không cản chân mã
        }
        return false;
    }

    // Xe (俥 / 車)
    if (name === '俥' || name === '車') {
        if (r1 !== r2 && c1 !== c2) return false;
        const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
        const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
        let currR = r1 + stepR;
        let currC = c1 + stepC;
        while (currR !== r2 || currC !== c2) {
            if (board[currR * 9 + currC] !== null) return false;
            currR += stepR;
            currC += stepC;
        }
        return true;
    }

    // Pháo (炮 / 砲)
    if (name === '炮' || name === '砲') {
        if (r1 !== r2 && c1 !== c2) return false;
        const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
        const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
        let currR = r1 + stepR;
        let currC = c1 + stepC;
        let count = 0;
        while (currR !== r2 || currC !== c2) {
            if (board[currR * 9 + currC] !== null) count++;
            currR += stepR;
            currC += stepC;
        }
        if (target === null) return count === 0;
        return count === 1; // Nhảy qua 1 quân để ăn
    }

    // Tốt / Binh (兵 / 卒)
    if (name === '兵' || name === '卒') {
        if (side === 'red') {
            if (dr === -1 && dc === 0) return true;
            if (r1 < 5 && dr === 0 && absDc === 1) return true; // Qua sông được đi ngang
        } else {
            if (dr === 1 && dc === 0) return true;
            if (r1 > 4 && dr === 0 && absDc === 1) return true;
        }
        return false;
    }

    return false;
}

// ==========================================
// CỜ CARO (12x12 GRID = 144 Ô)
// ==========================================
const CARO_SIZE = 12;
function checkCaroWin(board, lastIdx) {
    if (lastIdx === null || lastIdx < 0) return null;
    const sym = board[lastIdx];
    if (!sym) return null;

    const r = Math.floor(lastIdx / CARO_SIZE);
    const c = lastIdx % CARO_SIZE;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of dirs) {
        let cells = [lastIdx];
        let s = 1;
        while (true) {
            const nr = r + dr * s, nc = c + dc * s;
            if (nr < 0 || nr >= CARO_SIZE || nc < 0 || nc >= CARO_SIZE) break;
            const idx = nr * CARO_SIZE + nc;
            if (board[idx] === sym) { cells.push(idx); s++; } else break;
        }
        s = 1;
        while (true) {
            const nr = r - dr * s, nc = c - dc * s;
            if (nr < 0 || nr >= CARO_SIZE || nc < 0 || nc >= CARO_SIZE) break;
            const idx = nr * CARO_SIZE + nc;
            if (board[idx] === sym) { cells.push(idx); s++; } else break;
        }

        if (cells.length >= 5) return { winner: sym, winningCells: cells };
    }
    return null;
}

// ==========================================
// TOÀN BỘ TRẠNG THÁI GAME ZONE CHÍNH
// ==========================================
let gameState = {
    balances: {},       // { [username]: number }
    playerStats: {},    // { [username]: { won: 0, lost: 0, games: 0 } }
    hostCheats: {
        taixiu: null,   // 'tai' | 'xiu' | 'bao' | null
        xocdia: null,   // 'chan' | 'le' | '4red' | '4white' | null
        baucua: null    // 'bau' | 'cua' | 'tom' | 'ca' | 'nai' | 'ga' | null
    },
    timers: {
        taixiu: 20,
        xocdia: 20,
        baucua: 20
    },
    history: {
        taixiu: [],     // [{ result: [d1,d2,d3], total, type: 'tai'|'xiu'|'bao', time }]
        xocdia: [],     // [{ result: [c1,c2,c3,c4], reds, type: 'chan'|'le', subWin, time }]
        baucua: []      // [{ result: [r1,r2,r3], time }]
    },
    stats: {
        taixiu: { total: 0, tai: 0, xiu: 0, bao: 0 },
        xocdia: { total: 0, chan: 0, le: 0, red4: 0, white4: 0, red3: 0, white3: 0 },
        baucua: { total: 0, items: { bau: 0, cua: 0, tom: 0, ca: 0, nai: 0, ga: 0 } }
    },
    jackpotPool: 128500, // Quỹ Nổ Hũ Slot 777
    taixiu: {
        status: 'betting', // 'betting' | 'shaking' | 'revealed'
        result: [4, 5, 6],
        outcome: 'tai',
        total: 15,
        bets: []           // [{ user, betType: 'tai'|'xiu'|'bao', amount }]
    },
    xocdia: {
        status: 'betting', // 'betting' | 'shaking' | 'revealed'
        result: [1, 0, 1, 0],
        reds: 2,
        outcome: 'chan',
        subWin: null,
        bets: []           // [{ user, betType: 'chan'|'le'|'4red'|'4white'|..., amount }]
    },
    baucua: {
        status: 'betting', // 'betting' | 'shaking' | 'revealed'
        result: ['bau', 'cua', 'tom'],
        bets: []           // [{ user, betType: 'bau'|'cua'|..., amount }]
    },
    caro: {
        board: Array(144).fill(null),
        turn: 'X',
        players: { X: null, O: null },
        winner: null,
        winningCells: [],
        moveCount: 0
    },
    cotuong: {
        board: initChineseChessBoard(),
        turn: 'Red',
        players: { Red: null, Black: null },
        winner: null,
        moveCount: 0
    }
};

const BAUCUA_KEYS = ['nai', 'bau', 'ga', 'ca', 'cua', 'tom'];

// Broadcast game state to all
function broadcastGameState() {
    io.emit('game:sync', gameState);
}

// Cập nhật số dư người dùng
function ensureUserBalance(username) {
    if (gameState.balances[username] === undefined) {
        gameState.balances[username] = 10000; // Khởi đầu tặng 10.000 xu trải nghiệm
    }
    if (!gameState.playerStats[username]) {
        gameState.playerStats[username] = { won: 0, lost: 0, games: 0 };
    }
}

// ==========================================
// GAME ROLL / SETTLEMENT ENGINES
// ==========================================

// 1. TÀI XỈU
function hostRollTaiXiu() {
    let d1, d2, d3;
    const cheat = gameState.hostCheats.taixiu;

    if (cheat === 'tai') {
        do {
            d1 = Math.floor(Math.random() * 6) + 1;
            d2 = Math.floor(Math.random() * 6) + 1;
            d3 = Math.floor(Math.random() * 6) + 1;
        } while (d1 + d2 + d3 < 11 || (d1 === d2 && d2 === d3));
    } else if (cheat === 'xiu') {
        do {
            d1 = Math.floor(Math.random() * 6) + 1;
            d2 = Math.floor(Math.random() * 6) + 1;
            d3 = Math.floor(Math.random() * 6) + 1;
        } while (d1 + d2 + d3 > 10 || (d1 === d2 && d2 === d3));
    } else if (cheat === 'bao') {
        const val = Math.floor(Math.random() * 6) + 1;
        d1 = val; d2 = val; d3 = val;
    } else {
        d1 = Math.floor(Math.random() * 6) + 1;
        d2 = Math.floor(Math.random() * 6) + 1;
        d3 = Math.floor(Math.random() * 6) + 1;
    }

    gameState.hostCheats.taixiu = null; // Clear cheat sau khi xổ

    const sum = d1 + d2 + d3;
    const isBao = (d1 === d2 && d2 === d3);
    const outcome = isBao ? 'bao' : (sum >= 11 ? 'tai' : 'xiu');

    gameState.taixiu.result = [d1, d2, d3];
    gameState.taixiu.total = sum;
    gameState.taixiu.outcome = outcome;
    gameState.taixiu.status = 'revealed';
    gameState.timers.taixiu = 7; // Hiển thị kết quả 7 giây rồi ván mới

    // Cập nhật thống kê & soi cầu
    gameState.stats.taixiu.total++;
    if (outcome === 'bao') gameState.stats.taixiu.bao++;
    else if (outcome === 'tai') gameState.stats.taixiu.tai++;
    else gameState.stats.taixiu.xiu++;

    gameState.history.taixiu.unshift({
        result: [d1, d2, d3],
        total: sum,
        type: outcome,
        time: new Date().toLocaleTimeString('vi-VN')
    });
    if (gameState.history.taixiu.length > 30) gameState.history.taixiu.pop();

    // Trả thưởng cược Tài Xỉu
    gameState.taixiu.bets.forEach(b => {
        let won = false;
        let mult = 0;
        if (b.betType === 'bao' && isBao) { won = true; mult = 30; }
        else if (b.betType === 'tai' && outcome === 'tai') { won = true; mult = 1; }
        else if (b.betType === 'xiu' && outcome === 'xiu') { won = true; mult = 1; }

        if (won) {
            const prize = b.amount + b.amount * mult;
            gameState.balances[b.user] = (gameState.balances[b.user] || 0) + prize;
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].won++;
                gameState.playerStats[b.user].games++;
            }
        } else {
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].lost++;
                gameState.playerStats[b.user].games++;
            }
        }
    });

    broadcastGameState();
}

// 2. XÓC ĐĨA
function hostRollXocDia() {
    let c1, c2, c3, c4;
    const cheat = gameState.hostCheats.xocdia;

    if (cheat === 'chan') {
        do {
            c1 = Math.floor(Math.random() * 2);
            c2 = Math.floor(Math.random() * 2);
            c3 = Math.floor(Math.random() * 2);
            c4 = Math.floor(Math.random() * 2);
        } while ((c1 + c2 + c3 + c4) % 2 !== 0);
    } else if (cheat === 'le') {
        do {
            c1 = Math.floor(Math.random() * 2);
            c2 = Math.floor(Math.random() * 2);
            c3 = Math.floor(Math.random() * 2);
            c4 = Math.floor(Math.random() * 2);
        } while ((c1 + c2 + c3 + c4) % 2 === 0);
    } else if (cheat === '4red') {
        c1 = 1; c2 = 1; c3 = 1; c4 = 1;
    } else if (cheat === '4white') {
        c1 = 0; c2 = 0; c3 = 0; c4 = 0;
    } else {
        c1 = Math.floor(Math.random() * 2);
        c2 = Math.floor(Math.random() * 2);
        c3 = Math.floor(Math.random() * 2);
        c4 = Math.floor(Math.random() * 2);
    }

    gameState.hostCheats.xocdia = null; // Clear cheat

    const reds = c1 + c2 + c3 + c4;
    const isEven = (reds % 2 === 0);
    const mainWin = isEven ? 'chan' : 'le';
    let subWin = null;
    if (reds === 4) subWin = '4red';
    else if (reds === 0) subWin = '4white';
    else if (reds === 3) subWin = '3red1white';
    else if (reds === 1) subWin = '3white1red';

    gameState.xocdia.result = [c1, c2, c3, c4];
    gameState.xocdia.reds = reds;
    gameState.xocdia.outcome = mainWin;
    gameState.xocdia.subWin = subWin;
    gameState.xocdia.status = 'revealed';
    gameState.timers.xocdia = 7;

    // Cập nhật thống kê
    gameState.stats.xocdia.total++;
    if (isEven) gameState.stats.xocdia.chan++; else gameState.stats.xocdia.le++;
    if (reds === 4) gameState.stats.xocdia.red4++;
    if (reds === 0) gameState.stats.xocdia.white4++;
    if (reds === 3) gameState.stats.xocdia.red3++;
    if (reds === 1) gameState.stats.xocdia.white3++;

    gameState.history.xocdia.unshift({
        result: [c1, c2, c3, c4],
        reds,
        type: mainWin,
        subWin,
        time: new Date().toLocaleTimeString('vi-VN')
    });
    if (gameState.history.xocdia.length > 30) gameState.history.xocdia.pop();

    // Trả thưởng cược Xóc Đĩa
    gameState.xocdia.bets.forEach(b => {
        let won = false;
        let mult = 0;
        if (b.betType === mainWin) { won = true; mult = 1; }
        else if (b.betType === subWin) {
            won = true;
            mult = (subWin === '4red' || subWin === '4white') ? 12 : 3;
        }

        if (won) {
            const prize = b.amount + b.amount * mult;
            gameState.balances[b.user] = (gameState.balances[b.user] || 0) + prize;
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].won++;
                gameState.playerStats[b.user].games++;
            }
        } else {
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].lost++;
                gameState.playerStats[b.user].games++;
            }
        }
    });

    broadcastGameState();
}

// 3. BẦU CUA
function hostRollBauCua() {
    let r1, r2, r3;
    const cheat = gameState.hostCheats.baucua;

    if (cheat && BAUCUA_KEYS.includes(cheat)) {
        r1 = cheat;
        r2 = cheat;
        r3 = BAUCUA_KEYS[Math.floor(Math.random() * 6)];
    } else {
        r1 = BAUCUA_KEYS[Math.floor(Math.random() * 6)];
        r2 = BAUCUA_KEYS[Math.floor(Math.random() * 6)];
        r3 = BAUCUA_KEYS[Math.floor(Math.random() * 6)];
    }

    gameState.hostCheats.baucua = null;

    gameState.baucua.result = [r1, r2, r3];
    gameState.baucua.status = 'revealed';
    gameState.timers.baucua = 7;

    // Thống kê linh vật
    gameState.stats.baucua.total++;
    [r1, r2, r3].forEach(item => {
        if (gameState.stats.baucua.items[item] !== undefined) {
            gameState.stats.baucua.items[item]++;
        }
    });

    gameState.history.baucua.unshift({
        result: [r1, r2, r3],
        time: new Date().toLocaleTimeString('vi-VN')
    });
    if (gameState.history.baucua.length > 30) gameState.history.baucua.pop();

    // Trả thưởng
    gameState.baucua.bets.forEach(b => {
        let count = 0;
        if (r1 === b.betType) count++;
        if (r2 === b.betType) count++;
        if (r3 === b.betType) count++;

        if (count > 0) {
            const prize = b.amount + b.amount * count;
            gameState.balances[b.user] = (gameState.balances[b.user] || 0) + prize;
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].won++;
                gameState.playerStats[b.user].games++;
            }
        } else {
            if (gameState.playerStats[b.user]) {
                gameState.playerStats[b.user].lost++;
                gameState.playerStats[b.user].games++;
            }
        }
    });

    broadcastGameState();
}

// Timer vòng lặp trò chơi (Betting -> Shaking -> Revealed -> Reset)
setInterval(() => {
    let stateChanged = false;

    // Tài Xỉu Tick
    if (gameState.taixiu.status === 'betting') {
        gameState.timers.taixiu--;
        if (gameState.timers.taixiu <= 0) {
            gameState.taixiu.status = 'shaking';
            broadcastGameState();
            setTimeout(hostRollTaiXiu, 1800);
        } else stateChanged = true;
    } else if (gameState.taixiu.status === 'revealed') {
        gameState.timers.taixiu--;
        if (gameState.timers.taixiu <= 0) {
            gameState.taixiu.status = 'betting';
            gameState.taixiu.bets = [];
            gameState.timers.taixiu = 20;
            stateChanged = true;
        }
    }

    // Xóc Đĩa Tick
    if (gameState.xocdia.status === 'betting') {
        gameState.timers.xocdia--;
        if (gameState.timers.xocdia <= 0) {
            gameState.xocdia.status = 'shaking';
            broadcastGameState();
            setTimeout(hostRollXocDia, 1800);
        } else stateChanged = true;
    } else if (gameState.xocdia.status === 'revealed') {
        gameState.timers.xocdia--;
        if (gameState.timers.xocdia <= 0) {
            gameState.xocdia.status = 'betting';
            gameState.xocdia.bets = [];
            gameState.timers.xocdia = 20;
            stateChanged = true;
        }
    }

    // Bầu Cua Tick
    if (gameState.baucua.status === 'betting') {
        gameState.timers.baucua--;
        if (gameState.timers.baucua <= 0) {
            gameState.baucua.status = 'shaking';
            broadcastGameState();
            setTimeout(hostRollBauCua, 1800);
        } else stateChanged = true;
    } else if (gameState.baucua.status === 'revealed') {
        gameState.timers.baucua--;
        if (gameState.timers.baucua <= 0) {
            gameState.baucua.status = 'betting';
            gameState.baucua.bets = [];
            gameState.timers.baucua = 20;
            stateChanged = true;
        }
    }

    if (stateChanged) {
        broadcastGameState();
    }
}, 1000);

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

    // 1. NGƯỜI DÙNG THAM GIA PHÒNG
    socket.on('user:join', (data) => {
        const username = (data && data.username ? data.username.trim() : '') || `Thành viên_${socket.id.substring(0, 4)}`;
        const isTx = username.toUpperCase() === 'TX';
        const isFirstUser = users.size === 0 || !adminSocketId || isTx;

        ensureUserBalance(username);

        const user = {
            id: socket.id,
            username: username,
            joinedAt: Date.now(),
            isAdmin: isFirstUser,
            ip: clientIp
        };

        if (isTx) {
            // TX luôn được ưu tiên Admin cao nhất
            users.forEach(u => u.isAdmin = false);
            user.isAdmin = true;
            adminSocketId = socket.id;
        } else if (isFirstUser) {
            adminSocketId = socket.id;
        }

        users.set(socket.id, user);

        const ips = getLanIPs();
        const primaryLanUrl = getPrimaryLanUrl();

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
            onlineUrl: globalOnlineUrl,
            lanList: ips.map((item) => ({
                name: item.name,
                ip: item.address,
                url: `http://${item.address}:${PORT}`
            })),
            gameState: gameState
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

        broadcastGameState();
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

    // 3. THÊM BÀI HÁT (TỰ ĐỘNG NHẬN DIỆN LINK & TÌM KIẾM TÊN BÀI HÁT)
    socket.on('song:add', async (data) => {
        const user = users.get(socket.id) || { username: 'Thành viên', id: socket.id };
        const query = data && data.query ? data.query.trim() : '';
        if (!query) return;

        let ytId = extractYouTubeId(query);
        const isAudioUrl = query.match(/\.(mp3|wav|ogg|m4a)(\?.*)?$/i);
        let newSong = null;

        if (!ytId && !isAudioUrl) {
            // Người dùng nhập tên bài hát hoặc link dạng khác -> tìm kiếm tự động trên YouTube
            ytId = await searchYouTube(query);
        }

        if (ytId) {
            // Lấy thông tin thật: tiêu đề, nghệ sĩ, ảnh bìa
            const meta = await fetchYouTubeMeta(ytId);
            newSong = {
                id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                title: data.title || meta.title,
                artist: data.artist || meta.artist,
                url: `https://www.youtube.com/watch?v=${ytId}`,
                youtubeId: ytId,
                audioUrl: null,
                thumbnail: meta.thumbnail,
                duration: 240,
                addedBy: user.username,
                addedById: user.id,
                addedAt: Date.now(),
                votes: { [user.id]: 1 },
                voteScore: 1
            };
        } else if (isAudioUrl) {
            newSong = {
                id: 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                title: data.title || query.split('/').pop().split('?')[0] || 'Tệp âm thanh',
                artist: 'Âm thanh trực tiếp',
                url: query,
                youtubeId: null,
                audioUrl: query,
                thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop&q=80',
                duration: 200,
                addedBy: user.username,
                addedById: user.id,
                addedAt: Date.now(),
                votes: { [user.id]: 1 },
                voteScore: 1
            };
        } else {
            socket.emit('game:toast', { message: 'Không thể nhận diện bài hát hoặc link YouTube này!' });
            return;
        }

        if (!currentSong) {
            playSong(newSong);
        } else {
            playlist.push(newSong);
            playlist.sort((a, b) => b.voteScore - a.voteScore || a.addedAt - b.addedAt);
            io.emit('playlist:update', playlist);
        }

        io.emit('chat:system', {
            text: `🎵 ${user.username} đã đề xuất: "${newSong.title}" (${newSong.artist})`,
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

    // 4. ĐIỀU KHIỂN PHÁT NHẠC (NEXT, TOGGLE, SEEK, PREV)
    socket.on('control:action', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const action = data && data.action;
        const isTxOrAdmin = user.isAdmin || user.username.toUpperCase() === 'TX' || user.username.toLowerCase().includes('admin') || socket.id === adminSocketId;

        // Bỏ qua bài hát (Next) & Phát lại từ đầu (Prev): Cho phép mọi người dùng trong phòng thực hiện
        if (action === 'next') {
            playNextSong(true);
            io.emit('chat:system', {
                text: `⏭️ ${user.username} đã bấm chuyển bài hát kế tiếp!`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
            return;
        }

        if (action === 'prev') {
            if (currentSong) {
                playback.startedAt = Date.now();
                playback.elapsedAtPause = 0;
                io.emit('playback:sync', {
                    isPlaying: playback.isPlaying,
                    currentTime: 0,
                    serverTime: Date.now()
                });
                io.emit('chat:system', {
                    text: `⏮️ ${user.username} đã phát lại bài hát từ đầu.`,
                    time: new Date().toLocaleTimeString('vi-VN')
                });
            }
            return;
        }

        // Tạm dừng / Phát tiếp (Toggle) & Tua nhạc (Seek): Cần quyền Admin hoặc khi phòng ít người (<= 2)
        if (!isTxOrAdmin && users.size > 2) {
            socket.emit('control:error', { message: 'Chỉ Admin mới có quyền tạm dừng hoặc tua nhạc!' });
            return;
        }

        switch (action) {
            case 'toggle':
                if (!currentSong) {
                    if (playlist.length > 0) playNextSong(true);
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
        }
    });

    // ==========================================
    // 5. ADMIN MENU CONTROLS & CHEATS
    // ==========================================
    socket.on('admin:add_coins', (data) => {
        const user = users.get(socket.id);
        if (!user || (!user.isAdmin && user.username.toUpperCase() !== 'TX')) {
            socket.emit('admin:msg', { success: false, message: 'Bạn không có quyền Admin!' });
            return;
        }

        const target = data.target; // 'ALL' hoặc username cụ thể
        const amount = parseInt(data.amount) || 0;
        if (amount === 0) return;

        if (target === 'ALL') {
            users.forEach(u => {
                gameState.balances[u.username] = (gameState.balances[u.username] || 0) + amount;
                if (gameState.balances[u.username] < 0) gameState.balances[u.username] = 0;
            });
            io.emit('chat:system', {
                text: `🧧 ADMIN ${user.username} ĐÃ PHÁT LỘC TOÀN PHÒNG: +${amount.toLocaleString()} XU CHO TẤT CẢ! 🎉`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
        } else {
            gameState.balances[target] = (gameState.balances[target] || 0) + amount;
            if (gameState.balances[target] < 0) gameState.balances[target] = 0;
            io.emit('chat:system', {
                text: `👑 Admin ${user.username} đã ${amount > 0 ? 'cộng' : 'trừ'} ${Math.abs(amount).toLocaleString()} xu cho ${target}!`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
        }

        broadcastGameState();
        socket.emit('admin:msg', { success: true, message: `Đã thực hiện cộng/trừ xu thành công!` });
    });

    socket.on('admin:set_cheat', (data) => {
        const user = users.get(socket.id);
        if (!user || (!user.isAdmin && user.username.toUpperCase() !== 'TX')) {
            socket.emit('admin:msg', { success: false, message: 'Bạn không có quyền Admin!' });
            return;
        }

        const game = data.game;   // 'taixiu' | 'xocdia' | 'baucua'
        const value = data.value; // 'clear' hoặc 'tai'/'xiu'/'chan'/'le'...

        if (gameState.hostCheats[game] !== undefined) {
            gameState.hostCheats[game] = (value === 'clear' ? null : value);
            socket.emit('admin:msg', {
                success: true,
                message: `🎯 Đã thiết lập cheat cho ${game.toUpperCase()}: ${value.toUpperCase()}`
            });
            io.emit('admin:cheat_update', gameState.hostCheats);
        }
    });

    socket.on('admin:kick_user', (targetUsername) => {
        const user = users.get(socket.id);
        if (!user || (!user.isAdmin && user.username.toUpperCase() !== 'TX')) return;

        for (const [sockId, u] of users.entries()) {
            if (u.username === targetUsername && !u.isAdmin) {
                const targetSocket = io.sockets.sockets.get(sockId);
                if (targetSocket) {
                    targetSocket.emit('user:kicked', { reason: 'Bạn đã bị Admin mời ra khỏi phòng!' });
                    targetSocket.disconnect(true);
                }
                break;
            }
        }
    });

    // ==========================================
    // 6. MINI GAME ACTIONS & BETS
    // ==========================================

    // TÀI XỈU BET
    socket.on('taixiu:bet', (data) => {
        const user = users.get(socket.id);
        if (!user || gameState.taixiu.status !== 'betting') return;

        const amount = parseInt(data.amount);
        const betType = data.betType; // 'tai' | 'xiu' | 'bao'
        if (isNaN(amount) || amount <= 0 || !['tai', 'xiu', 'bao'].includes(betType)) return;

        const currentBal = gameState.balances[user.username] || 0;
        if (currentBal < amount) {
            socket.emit('game:toast', { message: 'Bạn không đủ xu để cược số tiền này!' });
            return;
        }

        gameState.balances[user.username] -= amount;

        const existing = gameState.taixiu.bets.find(b => b.user === user.username && b.betType === betType);
        if (existing) {
            existing.amount += amount;
        } else {
            gameState.taixiu.bets.push({ user: user.username, betType, amount });
        }

        broadcastGameState();
    });

    // XÓC ĐĨA BET
    socket.on('xocdia:bet', (data) => {
        const user = users.get(socket.id);
        if (!user || gameState.xocdia.status !== 'betting') return;

        const amount = parseInt(data.amount);
        const betType = data.betType; // 'chan'|'le'|'4red'|'4white'|'3red1white'|'3white1red'
        if (isNaN(amount) || amount <= 0) return;

        const currentBal = gameState.balances[user.username] || 0;
        if (currentBal < amount) {
            socket.emit('game:toast', { message: 'Bạn không đủ xu để đặt cược!' });
            return;
        }

        gameState.balances[user.username] -= amount;

        const existing = gameState.xocdia.bets.find(b => b.user === user.username && b.betType === betType);
        if (existing) {
            existing.amount += amount;
        } else {
            gameState.xocdia.bets.push({ user: user.username, betType, amount });
        }

        broadcastGameState();
    });

    // BẦU CUA BET
    socket.on('baucua:bet', (data) => {
        const user = users.get(socket.id);
        if (!user || gameState.baucua.status !== 'betting') return;

        const amount = parseInt(data.amount);
        const betType = data.betType;
        if (isNaN(amount) || amount <= 0 || !BAUCUA_KEYS.includes(betType)) return;

        const currentBal = gameState.balances[user.username] || 0;
        if (currentBal < amount) {
            socket.emit('game:toast', { message: 'Bạn không đủ xu để đặt cược!' });
            return;
        }

        gameState.balances[user.username] -= amount;

        const existing = gameState.baucua.bets.find(b => b.user === user.username && b.betType === betType);
        if (existing) {
            existing.amount += amount;
        } else {
            gameState.baucua.bets.push({ user: user.username, betType, amount });
        }

        broadcastGameState();
    });

    // CARO XO ACTIONS
    socket.on('caro:join', (role) => {
        const user = users.get(socket.id);
        if (!user) return;
        if (role === 'X' || role === 'O') {
            if (!gameState.caro.players[role] || gameState.caro.players[role].id === socket.id) {
                gameState.caro.players[role] = { id: socket.id, name: user.username };
                broadcastGameState();
                io.emit('chat:system', {
                    text: `⚔️ ${user.username} đã chọn cầm quân ${role} trong Cờ Caro!`,
                    time: new Date().toLocaleTimeString('vi-VN')
                });
            }
        }
    });

    socket.on('caro:move', (idx) => {
        const user = users.get(socket.id);
        if (!user || gameState.caro.winner) return;

        const currentTurn = gameState.caro.turn;
        const player = gameState.caro.players[currentTurn];
        if (!player || player.name !== user.username) {
            socket.emit('game:toast', { message: 'Chưa tới lượt bạn đánh hoặc bạn chưa chọn phe!' });
            return;
        }

        if (idx < 0 || idx >= 144 || gameState.caro.board[idx] !== null) return;

        gameState.caro.board[idx] = currentTurn;
        gameState.caro.moveCount++;

        const winInfo = checkCaroWin(gameState.caro.board, idx);
        if (winInfo) {
            gameState.caro.winner = winInfo.winner;
            gameState.caro.winningCells = winInfo.winningCells;
            const winnerName = gameState.caro.players[winInfo.winner]?.name || winInfo.winner;
            io.emit('chat:system', {
                text: `🏆 Kỳ thủ ${winnerName} (Phe ${winInfo.winner}) đã chiến thắng Cờ Caro!`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
            // Thưởng xu cho người thắng
            gameState.balances[winnerName] = (gameState.balances[winnerName] || 0) + 1000;
        } else if (gameState.caro.moveCount >= 144) {
            gameState.caro.winner = 'Hòa';
            io.emit('chat:system', {
                text: '🤝 Ván cờ Caro đã kết thúc với kết quả Hòa!',
                time: new Date().toLocaleTimeString('vi-VN')
            });
        } else {
            gameState.caro.turn = currentTurn === 'X' ? 'O' : 'X';
        }

        broadcastGameState();
    });

    socket.on('caro:reset', () => {
        gameState.caro.board = Array(144).fill(null);
        gameState.caro.turn = 'X';
        gameState.caro.winner = null;
        gameState.caro.winningCells = [];
        gameState.caro.moveCount = 0;
        broadcastGameState();
    });

    // CỜ TƯỚNG ACTIONS
    socket.on('cotuong:join', (role) => {
        const user = users.get(socket.id);
        if (!user) return;
        if (role === 'Red' || role === 'Black') {
            if (!gameState.cotuong.players[role] || gameState.cotuong.players[role].id === socket.id) {
                gameState.cotuong.players[role] = { id: socket.id, name: user.username };
                broadcastGameState();
                io.emit('chat:system', {
                    text: `☖ ${user.username} đã chọn cầm quân ${role === 'Red' ? 'Đỏ' : 'Đen'} trong Cờ Tướng!`,
                    time: new Date().toLocaleTimeString('vi-VN')
                });
            }
        }
    });

    socket.on('cotuong:move', (data) => {
        const user = users.get(socket.id);
        if (!user || gameState.cotuong.winner) return;

        const currentTurn = gameState.cotuong.turn;
        const player = gameState.cotuong.players[currentTurn];
        if (!player || player.name !== user.username) {
            socket.emit('game:toast', { message: 'Chưa tới lượt của bạn hoặc bạn chưa chọn bên!' });
            return;
        }

        const from = data.from;
        const to = data.to;
        if (from === undefined || to === undefined || !validateCoTuongMove(gameState.cotuong.board, from, to)) {
            socket.emit('game:toast', { message: 'Nước đi không hợp lệ theo luật Cờ Tướng!' });
            return;
        }

        const movingPiece = gameState.cotuong.board[from];
        const targetPiece = gameState.cotuong.board[to];

        gameState.cotuong.board[to] = movingPiece;
        gameState.cotuong.board[from] = null;
        gameState.cotuong.moveCount++;

        // Kiểm tra bắt Tướng (Thắng trận)
        if (targetPiece && (targetPiece.name === '帥' || targetPiece.name === '將')) {
            gameState.cotuong.winner = currentTurn;
            const winnerName = gameState.cotuong.players[currentTurn]?.name || currentTurn;
            io.emit('chat:system', {
                text: `🏆 Kỳ vương ${winnerName} (${currentTurn === 'Red' ? 'Phe Đỏ' : 'Phe Đen'}) đã bắt được Tướng và chiến thắng vẻ vang!`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
            gameState.balances[winnerName] = (gameState.balances[winnerName] || 0) + 2000;
        } else {
            gameState.cotuong.turn = currentTurn === 'Red' ? 'Black' : 'Red';
        }

        broadcastGameState();
    });

    socket.on('cotuong:reset', () => {
        gameState.cotuong.board = initChineseChessBoard();
        gameState.cotuong.turn = 'Red';
        gameState.cotuong.winner = null;
        gameState.cotuong.moveCount = 0;
        broadcastGameState();
    });

    // SLOT 777 QUAY HŨ (ARCADE MINIBOX)
    socket.on('slot:spin', (betAmount, callback) => {
        const user = users.get(socket.id);
        if (!user) return;

        const bet = parseInt(betAmount) || 50;
        const currentBal = gameState.balances[user.username] || 0;
        if (currentBal < bet) {
            if (typeof callback === 'function') callback({ success: false, message: 'Bạn không đủ xu để quay hũ!' });
            return;
        }

        gameState.balances[user.username] -= bet;
        gameState.jackpotPool += Math.floor(bet * 0.15); // 15% cược được trích vào Hũ

        const slotSymbols = ['🍒', '🍋', '🍊', '🍇', '🔔', '🍉', '7️⃣'];
        const isJackpot = Math.random() < 0.02; // 2% nổ hũ nếu may mắn
        let r1, r2, r3;

        if (isJackpot) {
            r1 = '7️⃣'; r2 = '7️⃣'; r3 = '7️⃣';
        } else {
            r1 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
            r2 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
            r3 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
        }

        let winAmount = 0;
        let winType = '';

        if (r1 === '7️⃣' && r2 === '7️⃣' && r3 === '7️⃣') {
            winAmount = gameState.jackpotPool;
            winType = 'JACKPOT';
            gameState.jackpotPool = 50000; // Reset hũ
            io.emit('chat:system', {
                text: `💥💥💥 TIN NÓNG: ${user.username} VỪA NỔ HŨ TOÀN PHÒNG VỚI 7️⃣7️⃣7️⃣! ĂN TRỌN ${winAmount.toLocaleString()} XU! 💥💥💥`,
                time: new Date().toLocaleTimeString('vi-VN')
            });
        } else if (r1 === '🔔' && r2 === '🔔' && r3 === '🔔') {
            winAmount = bet * 25;
            winType = 'TRIPLE_BELL';
        } else if (r1 === r2 && r2 === r3) {
            winAmount = bet * 15;
            winType = 'TRIPLE_MATCH';
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
            winAmount = Math.floor(bet * 2);
            winType = 'PAIR_MATCH';
        }

        if (winAmount > 0) {
            gameState.balances[user.username] += winAmount;
        }

        broadcastGameState();

        if (typeof callback === 'function') {
            callback({
                success: true,
                reels: [r1, r2, r3],
                winAmount,
                winType,
                newBalance: gameState.balances[user.username],
                jackpotPool: gameState.jackpotPool
            });
        }
    });

    // MINI BÀI CÀO 3 LÁ (ARCADE CARD GAME)
    socket.on('card:play', (betAmount, callback) => {
        const user = users.get(socket.id);
        if (!user) return;

        const bet = parseInt(betAmount) || 50;
        const currentBal = gameState.balances[user.username] || 0;
        if (currentBal < bet) {
            if (typeof callback === 'function') callback({ success: false, message: 'Bạn không đủ xu để chơi!' });
            return;
        }

        gameState.balances[user.username] -= bet;

        const suits = ['♠', '♥', '♦', '♣'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const deck = [];
        suits.forEach(s => values.forEach(v => deck.push({ value: v, suit: s })));
        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        const playerCards = [deck.pop(), deck.pop(), deck.pop()];
        const dealerCards = [deck.pop(), deck.pop(), deck.pop()];

        function getCardScore(cards) {
            let total = 0;
            let faces = 0;
            cards.forEach(c => {
                if (['10', 'J', 'Q', 'K'].includes(c.value)) {
                    faces++;
                } else if (c.value === 'A') total += 1;
                else total += parseInt(c.value);
            });
            if (faces === 3) return { score: 10, name: 'Ba Tây (Tiên)' };
            if (cards[0].value === cards[1].value && cards[1].value === cards[2].value) {
                return { score: 11, name: 'Sáp (Cực Lớn)' };
            }
            const pts = total % 10;
            return { score: pts, name: `${pts} Nút` };
        }

        const pScore = getCardScore(playerCards);
        const dScore = getCardScore(dealerCards);

        let won = false;
        let isTie = false;
        if (pScore.score > dScore.score) won = true;
        else if (pScore.score === dScore.score) isTie = true;

        let prize = 0;
        if (won) {
            prize = bet * 2;
            gameState.balances[user.username] += prize;
        } else if (isTie) {
            prize = bet;
            gameState.balances[user.username] += prize;
        }

        broadcastGameState();

        if (typeof callback === 'function') {
            callback({
                success: true,
                playerCards,
                dealerCards,
                pScore,
                dScore,
                won,
                isTie,
                prize,
                newBalance: gameState.balances[user.username]
            });
        }
    });

    // 7. NGẮT KẾT NỐI (DISCONNECT)
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (!user) return;

        users.delete(socket.id);

        let caroChanged = false;
        if (gameState.caro.players.X && gameState.caro.players.X.id === socket.id) {
            gameState.caro.players.X = null;
            caroChanged = true;
        }
        if (gameState.caro.players.O && gameState.caro.players.O.id === socket.id) {
            gameState.caro.players.O = null;
            caroChanged = true;
        }

        let cotuongChanged = false;
        if (gameState.cotuong.players.Red && gameState.cotuong.players.Red.id === socket.id) {
            gameState.cotuong.players.Red = null;
            cotuongChanged = true;
        }
        if (gameState.cotuong.players.Black && gameState.cotuong.players.Black.id === socket.id) {
            gameState.cotuong.players.Black = null;
            cotuongChanged = true;
        }

        if (caroChanged || cotuongChanged) broadcastGameState();

        io.emit('chat:system', {
            text: `🚪 ${user.username} đã rời khỏi văn phòng.`,
            time: new Date().toLocaleTimeString('vi-VN')
        });

        if (socket.id === adminSocketId) {
            electNewAdmin(`(do Admin ${user.username} đã ngắt kết nối)`);
        } else {
            io.emit('users:update', {
                count: users.size,
                users: Array.from(users.values())
            });
        }
    });
});

// KHỞI CHẠY SERVER LAN & ONLINE
server.listen(PORT, '0.0.0.0', async () => {
    const lanIps = getLanIPs();
    console.log('\n======================================================');
    console.log('   🎧 LAN MUSIC OFFICE & GAME ZONE - SERVER REALTIME');
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
    console.log('* Tính năng: Time-Sync, Auto Admin, Vote Playlist, Cờ Tướng, Cờ Caro AI, Slot 777, Bài Cào');

    // Kiểm tra nếu bật chế độ Online qua tham số --online hoặc biến môi trường ONLINE=true
    const isOnlineRequested = process.argv.includes('--online') || process.env.ONLINE === 'true';
    if (isOnlineRequested) {
        console.log('> Đang khởi tạo đường hầm Online toàn cầu (Cloudflare HTTPS)...');
        let tunnelStarted = false;
        try {
            const { spawn } = require('child_process');
            const cpCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            const tunnelProcess = spawn(cpCmd, ['--yes', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`], { shell: true });
            
            tunnelProcess.stderr.on('data', (data) => {
                const text = data.toString();
                const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (match && !tunnelStarted) {
                    tunnelStarted = true;
                    globalOnlineUrl = match[0];
                    console.log('======================================================');
                    console.log('🌐 ĐÃ KÍCH HOẠT ĐƯỜNG DẪN ONLINE TOÀN CẦU (CLOUDFLARE HTTPS):');
                    console.log(`👉 ${globalOnlineUrl}`);
                    console.log('(Bất kỳ ai ở ngoài mạng LAN cũng có thể truy cập link này!)');
                    console.log('======================================================\n');
                    io.emit('online:update', { onlineUrl: globalOnlineUrl });
                }
            });

            tunnelProcess.on('close', () => {
                if (globalOnlineUrl) {
                    console.log('> Đường hầm Cloudflare đã đóng.');
                    globalOnlineUrl = null;
                }
            });

            // Fallback sang Localtunnel nếu Cloudflare chưa nhận sau 5.5 giây
            setTimeout(async () => {
                if (!tunnelStarted && !globalOnlineUrl) {
                    console.log('> Đang chuyển sang Localtunnel dự phòng...');
                    try {
                        const localtunnel = require('localtunnel');
                        const tunnel = await localtunnel({ port: PORT });
                        globalOnlineUrl = tunnel.url;
                        tunnelStarted = true;
                        console.log('======================================================');
                        console.log('🌐 ĐÃ KÍCH HOẠT ĐƯỜNG DẪN ONLINE TOÀN CẦU (LOCALTUNNEL):');
                        console.log(`👉 ${globalOnlineUrl}`);
                        console.log('(Bất kỳ ai ở ngoài mạng LAN cũng có thể truy cập link này!)');
                        console.log('======================================================\n');
                        io.emit('online:update', { onlineUrl: globalOnlineUrl });
                        tunnel.on('close', () => { globalOnlineUrl = null; });
                    } catch(errLt) {
                        console.warn('> Không thể tạo đường hầm qua Localtunnel:', errLt.message);
                    }
                }
            }, 5500);
        } catch(err) {
            console.warn('> Lỗi khi khởi chạy đường hầm Online:', err.message);
        }
    } else {
        console.log('* Mẹo Online: Chạy "start-online.bat" hoặc "npm run online" để mở link Internet ra ngoài mạng LAN');
        console.log('======================================================\n');
    }
});
