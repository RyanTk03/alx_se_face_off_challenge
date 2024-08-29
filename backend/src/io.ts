import http from "http";
import { Server, Socket } from "socket.io";
import { SocketEvent } from "./utils/socketEvents.js";

type Message = {
  name: string;
  text: string;
  time: string;
};

let cachedIo: Server | null = null;
const roomSize = 2;

function getRoom(roomId: string) {
  return cachedIo?.sockets.adapter.rooms.get(roomId);
}

async function joinSocketToRoom(
  socket: Socket,
  roomId: string,
  avatar: string
) {
  try {
    await socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
    cachedIo?.to(roomId).emit(SocketEvent.ROOM_JOINED, socket.id, avatar);
    const room = getRoom(roomId);
    if (room && room.size === roomSize) {
      console.log(`Room ${roomId} is full.`);
      cachedIo?.to(roomId).emit(SocketEvent.ROOM_FULL, Array.from(room));
    }
  } catch (error) {
    console.error(`Invalid room id: ${roomId}`);
    socket.emit(SocketEvent.ERROR, { error });
  }
}

function canJoinRoom(socket: Socket, roomId: string) {
  const room = getRoom(roomId);
  if (room && room.size < roomSize) {
    return true;
  } else {
    console.error(`Room ${roomId} is full.`);
    socket.emit(SocketEvent.ERROR, { message: "Room is full." });
    return false;
  }
}

function checkMovePosition(position: number) {
  return position >= 0 && position < 9;
}

function initSocketIo(
  httpServerInstance: http.Server<
    typeof http.IncomingMessage,
    typeof http.ServerResponse
  >
) {
  if (cachedIo) {
    return cachedIo;
  } else {
    cachedIo = new Server(httpServerInstance, {
      cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      },
    });

    cachedIo.on(SocketEvent.CONNECTION, (socket) => {
      console.log("A user connected");
      //TODO: Manage user session

      socket.on(SocketEvent.CREATE_ROOM, async (roomId: string) => {
        const roomExists = !!getRoom(roomId);

        if (roomExists) {
          console.error(`Room ${roomId} already exist.`);
          socket.emit(SocketEvent.ERROR, { message: "Room already exist." });
        } else {
          joinSocketToRoom(socket, roomId, "X");
        }
      });

      socket.on(SocketEvent.JOIN_ROOM, async (roomId: string) => {
        const roomExists = !!getRoom(roomId);

        if (!roomExists) {
          console.error(`Room ${roomId} does not exist.`);
          socket.emit(SocketEvent.ERROR, { message: "Room does not exist." });
        } else {
          canJoinRoom(socket, roomId) && joinSocketToRoom(socket, roomId, "O");
        }
      });

      socket.on(
        SocketEvent.MAKE_MOVE,
        (moveData: { position: number; roomId: string }) => {
          if (
            checkMovePosition(moveData.position) &&
            socket.rooms.has(moveData.roomId)
          ) {
            const emited = cachedIo
              ?.to(moveData.roomId)
              .emit(SocketEvent.MOVE_MADE, moveData, socket.id);

            if (!emited) {
              console.error(`Failled to emit event for user ${socket.id}`);
              socket.emit(SocketEvent.ERROR, {
                message: "Move made not shared.",
              });
            }
          }
        }
      );

      socket.on(
        SocketEvent.MESSAGE,
        (data: { msg: Message; roomId: string }) => {
          console.log("MESSAGE");
          if (socket.rooms.has(data.roomId)) {
            const emited = cachedIo
              ?.to(data.roomId)
              .emit("newMessage", data.msg, socket.id);

            if (!emited) {
              console.error(`Failled to emit event for user ${socket.id}`);
              socket.emit("messageError", {
                message: "Unable to send message.",
              });
            }
          }
        }
      );

      socket.on('disconnect', () => {
        console.log(socket.id, 'has disconnected');
        cachedIo?.emit('disconnected', socket.id)
      });

      socket.on(SocketEvent.DELETE_ROOM, (roomId: string) => {
        const room = getRoom(roomId);

        if (room) {
          cachedIo
            ?.to(roomId)
            .emit("roomDeleted", { message: "The room has been deleted." });
          cachedIo?.sockets.adapter.rooms.delete(roomId);
          console.log(`Room ${roomId} deleted`);
        } else {
          console.error(`Room ${roomId} does not exist.`);
          socket.emit("error", { message: "Room does not exist." });
        }
      });
    });
    return cachedIo;
  }
}

export { initSocketIo };
