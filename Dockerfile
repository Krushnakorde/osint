# =========================================================
# Multi-stage Dockerfile for OSINT Fraud Framework
# Serves both the Node.js backend and the React SPA frontend
# =========================================================

# Stage 1: Build the Vite React Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Cache and install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy backend (required for TypeScript type imports) and frontend source
COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Runtime Backend & Static Serving
FROM node:22-alpine
WORKDIR /app

# Install production dependencies for the backend
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend application source, configuration, and data
COPY backend/ ./backend/

# Copy the built production frontend assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Default environment variables
ENV NODE_ENV=production
ENV PORT=4000
ENV STORAGE=mongo
ENV MONGO_URL=mongodb://127.0.0.1:27017/osint

EXPOSE 4000

CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "backend/src/server.ts"]
