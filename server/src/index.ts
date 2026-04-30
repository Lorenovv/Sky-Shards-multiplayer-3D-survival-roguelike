// Точка входа сервера: Express для статики/health, Socket.IO для игрового канала.
// Одна комната по умолчанию (можно расширить на несколько).

import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientHello, ClientToServer, ServerToClient } from "@sky-shards/shared";
import { GameRoom } from "./GameRoom.js";

const PORT = Number(process.env.PORT ?? 3001);
const SEED = Number(process.env.SKY_SEED ?? Math.floor(Math.random() * 0xFFFFFFFF));

const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// Раздача собранного клиента в production.
// На Render и других одно-сервисных деплоях клиент и сервер живут на одном origin.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  console.log(`[server] serving static client from ${clientDist}`);
  app.use(express.static(clientDist, { maxAge: "1h", index: false }));
  // SPA fallback — отдаём index.html на любой не-API маршрут.
  app.get(/^(?!\/(socket\.io|health)).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = http.createServer(app);
const io: Server<ClientToServer, ServerToClient> = new Server(httpServer, {
  cors: { origin: "*" },
  pingInterval: 5000,
  pingTimeout: 8000,
});

const ROOM_ID = "main";
const room = new GameRoom(io, ROOM_ID, SEED);
room.start();
console.log(`[server] Sky Shards starting (seed=${SEED}) on :${PORT}`);

io.on("connection", (socket) => {
  socket.join(ROOM_ID);
  let attached = false;
  socket.on("hello", (msg: ClientHello) => {
    if (attached) return;
    attached = true;
    const id = room.attachSocket(socket, msg.name);
    console.log(`[server] player connected: ${id} (${msg.name})`);
  });
  socket.on("disconnect", () => {
    if (attached) {
      room.detachSocket(socket.id);
      console.log(`[server] player disconnected: ${socket.id}`);
    }
  });
});

// Очистка пустых комнат: если комната пуста >5 минут — пересоздаём.
setInterval(() => {
  if (room.isEmptyFor(5 * 60 * 1000)) {
    console.log("[server] room empty >5m, restarting...");
    room.stop();
    const fresh = new GameRoom(io, ROOM_ID, Math.floor(Math.random() * 0xFFFFFFFF));
    fresh.start();
    // Простейшая замена ссылки — в реальном коде нужен реестр.
    Object.assign(room, fresh);
  }
}, 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
