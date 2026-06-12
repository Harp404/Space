# ---- Build stage ----
FROM golang:1.21-alpine AS builder

WORKDIR /build

# Copy dependency files first for layer caching
COPY go.mod ./
# go.sum is optional — tidy will regenerate it
RUN go mod download || true

# Copy all Go source files
COPY *.go ./

# Build the binary
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /astromesh .

# ---- Final stage ----
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /astromesh /astromesh

EXPOSE 8080

CMD ["/astromesh"]
