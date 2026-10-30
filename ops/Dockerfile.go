# Multi-stage build of apps/settlement. compose runs ./settlement daemon.
FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download
COPY apps/settlement/ ./
RUN CGO_ENABLED=0 go build -o /out/settlement ./cmd/settlement

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/settlement ./settlement
EXPOSE 8091
ENTRYPOINT []
CMD ["./settlement", "daemon"]
