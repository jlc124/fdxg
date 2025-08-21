const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	maxHttpBufferSize: 2e7 // ~20MB to allow image data URIs
});

// Simple in-memory state
const codeToFan = new Map(); // registrationCode -> { name, surname, birthYear, socketId, lastPreview }
const socketIdToCode = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Basic health route
app.get('/health', (_req, res) => {
	res.json({ ok: true });
});

io.on('connection', (socket) => {
	// Admin may request initial list
	socket.on('admin:hello', () => {
		socket.emit('admin:updateList', getRegistrationsSummary());
	});

	// Registration from client device after scanning or entering code
	socket.on('register:join', ({ code, name, surname, birthYear }) => {
		if (!code || !name || !surname || !birthYear) return;
		codeToFan.set(code, { name, surname, birthYear, socketId: socket.id, lastPreview: null });
		socketIdToCode.set(socket.id, code);
		io.emit('admin:updateList', getRegistrationsSummary());
	});

	// Live preview frames from client device camera (small, throttled on client)
	socket.on('register:preview', ({ imageData }) => {
		const code = socketIdToCode.get(socket.id);
		if (!code) return;
		const fan = codeToFan.get(code);
		if (!fan) return;
		fan.lastPreview = imageData;
		io.emit('admin:preview', { code, imageData });
	});

	// Admin requests capture from a specific code
	socket.on('admin:captureRequest', ({ code }) => {
		const fan = codeToFan.get(code);
		if (!fan) return;
		io.to(fan.socketId).emit('register:captureNow');
	});

	// Client sends captured still image
	socket.on('register:captureResult', ({ code, imageData }) => {
		if (!code || !imageData) return;
		io.emit('screen:show', { code, imageData });
	});

	// Cleanup on disconnect
	socket.on('disconnect', () => {
		const code = socketIdToCode.get(socket.id);
		if (!code) return;
		socketIdToCode.delete(socket.id);
		const fan = codeToFan.get(code);
		if (fan && fan.socketId === socket.id) {
			codeToFan.delete(code);
			io.emit('admin:updateList', getRegistrationsSummary());
		}
	});
});

function getRegistrationsSummary() {
	return Array.from(codeToFan.entries()).map(([code, fan]) => ({
		code,
		name: fan.name,
		surname: fan.surname,
		birthYear: fan.birthYear,
		hasPreview: Boolean(fan.lastPreview)
	}));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});

