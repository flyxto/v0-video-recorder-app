"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Camera, Square, AlertCircle, RefreshCw } from "lucide-react"

interface Overlay {
  text: string
  color: string
  bgColor: string
  startTime: number
  duration: number
}

const OVERLAYS: Overlay[] = [
  {
    text: "Tell us your story!",
    color: "#FF6B6B",
    bgColor: "rgba(255, 107, 107, 0.3)",
    startTime: 0,
    duration: 5000,
  },
  {
    text: "What brings you here today?",
    color: "#4ECDC4",
    bgColor: "rgba(78, 205, 196, 0.3)",
    startTime: 5000,
    duration: 5000,
  },
  {
    text: "Share your experience!",
    color: "#45B7D1",
    bgColor: "rgba(69, 183, 209, 0.3)",
    startTime: 10000,
    duration: 5000,
  },
]

const RECORDING_DURATION = 15000 // 15 seconds in ms

export default function VideoRecorder() {
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number>()
  const recordingStartTimeRef = useRef<number>()
  const chunksRef = useRef<Blob[]>([])

  // State
  const [isRecording, setIsRecording] = useState(false)
  const [timeLeft, setTimeLeft] = useState(15)
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [currentOverlay, setCurrentOverlay] = useState<Overlay | null>(null)

  // Initialize camera
  const initializeCamera = useCallback(async () => {
    try {
      setError("")

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1080, min: 720 },
          height: { ideal: 1920, min: 1280 },
          frameRate: { ideal: 30, min: 24 },
          facingMode: "user",
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play()
          setupCanvas()
          setCameraReady(true)
        }
      }
    } catch (err: any) {
      console.error("Camera error:", err)
      if (err.name === "NotAllowedError") {
        setError("Camera access denied. Please allow camera permissions.")
      } else if (err.name === "NotFoundError") {
        setError("No camera found. Please connect a camera.")
      } else {
        setError("Failed to access camera. Please check your device.")
      }
    }
  }, [])

  // Setup canvas and start animation loop
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    // Set canvas dimensions for high quality
    canvas.width = 1080
    canvas.height = 1920

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true, // Better performance
    })
    if (!ctx) return

    // Optimize canvas rendering
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"

    let frameCount = 0

    const render = () => {
      if (!canvas || !video || !ctx) return

      try {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw video frame
        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        }

        // Draw overlays if recording
        if (isRecording && recordingStartTimeRef.current) {
          drawOverlays(ctx)
        }

        // Debug: frame counter (remove in production)
        frameCount++
        if (frameCount % 30 === 0) {
          console.log(`Rendered ${frameCount} frames`)
        }
      } catch (err) {
        console.error("Render error:", err)
      }

      animationRef.current = requestAnimationFrame(render)
    }

    render()
  }, [isRecording])

  // Draw text overlays on canvas
  const drawOverlays = (ctx: CanvasRenderingContext2D) => {
    if (!recordingStartTimeRef.current) return

    const elapsed = Date.now() - recordingStartTimeRef.current

    // Find current overlay
    const activeOverlay = OVERLAYS.find(
      (overlay) => elapsed >= overlay.startTime && elapsed < overlay.startTime + overlay.duration,
    )

    if (!activeOverlay) return

    // Update current overlay state
    if (currentOverlay !== activeOverlay) {
      setCurrentOverlay(activeOverlay)
    }

    // Calculate fade effect
    const overlayElapsed = elapsed - activeOverlay.startTime
    const fadeTime = 500 // 500ms fade
    let opacity = 1

    if (overlayElapsed < fadeTime) {
      opacity = overlayElapsed / fadeTime
    } else if (overlayElapsed > activeOverlay.duration - fadeTime) {
      opacity = (activeOverlay.duration - overlayElapsed) / fadeTime
    }

    opacity = Math.max(0, Math.min(1, opacity))

    // Set font and measure text
    ctx.font = "bold 64px -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const textMetrics = ctx.measureText(activeOverlay.text)
    const textWidth = textMetrics.width
    const textHeight = 80 // Approximate height

    // Position
    const x = canvasRef.current!.width / 2
    const y = canvasRef.current!.height - 300

    // Draw background
    ctx.globalAlpha = opacity * 0.8
    ctx.fillStyle = activeOverlay.bgColor
    ctx.fillRect(x - textWidth / 2 - 40, y - textHeight / 2 - 20, textWidth + 80, textHeight + 40)

    // Draw text outline for better readability
    ctx.globalAlpha = opacity
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)"
    ctx.lineWidth = 4
    ctx.strokeText(activeOverlay.text, x, y)

    // Draw text
    ctx.fillStyle = activeOverlay.color
    ctx.fillText(activeOverlay.text, x, y)

    // Reset alpha
    ctx.globalAlpha = 1
  }

  // Start recording
  const startRecording = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !streamRef.current) {
      setError("Camera not ready. Please try again.")
      return
    }

    try {
      setError("")

      // Create canvas stream with explicit frame rate
      const canvasStream = canvas.captureStream(30)
      console.log("Canvas stream tracks:", canvasStream.getTracks())

      // Add audio from original stream
      const audioTrack = streamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        canvasStream.addTrack(audioTrack.clone())
        console.log("Added audio track")
      }

      // Check supported MIME types
      const mimeTypes = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]

      let mimeType = ""
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          console.log("Using MIME type:", type)
          break
        }
      }

      if (!mimeType) {
        throw new Error("No supported video format found")
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 8000000, // 8 Mbps
        audioBitsPerSecond: 128000, // 128 kbps
      })

      chunksRef.current = []
      mediaRecorderRef.current = mediaRecorder

      // Set up event handlers
      mediaRecorder.ondataavailable = (event) => {
        console.log("Data available:", event.data.size, "bytes")
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        console.log("Recording stopped, processing...")
        setIsProcessing(true)

        setTimeout(() => {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          console.log("Final blob size:", blob.size, "bytes")

          const url = URL.createObjectURL(blob)
          setDownloadUrl(url)
          setIsProcessing(false)

          // Auto download
          const a = document.createElement("a")
          a.href = url
          a.download = `event-video-${Date.now()}.webm`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }, 500)
      }

      mediaRecorder.onerror = (event: any) => {
        console.error("MediaRecorder error:", event.error)
        setError("Recording failed. Please try again.")
        setIsRecording(false)
      }

      // Start recording
      recordingStartTimeRef.current = Date.now()
      setIsRecording(true)
      setTimeLeft(15)
      setCurrentOverlay(null)

      mediaRecorder.start(100) // Collect data every 100ms
      console.log("Recording started")

      // Countdown timer
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            stopRecording()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err: any) {
      console.error("Start recording error:", err)
      setError(`Recording failed: ${err.message}`)
      setIsRecording(false)
    }
  }, [])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
      console.log("Stopping recording...")
    }
    setIsRecording(false)
    setCurrentOverlay(null)
  }, [])

  // Reset for new recording
  const resetApp = () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl)
    }
    setDownloadUrl("")
    setTimeLeft(15)
    setError("")
    setIsProcessing(false)
    setCurrentOverlay(null)
  }

  // Initialize on mount
  useEffect(() => {
    initializeCamera()

    return () => {
      // Cleanup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl)
      }
    }
  }, [initializeCamera])

  // Start canvas animation when camera is ready
  useEffect(() => {
    if (cameraReady) {
      setupCanvas()
    }
  }, [cameraReady, setupCanvas])

  // Error state
  if (error && !cameraReady) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-4">Camera Access Required</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <button
            onClick={initializeCamera}
            className="flex items-center justify-center space-x-2 bg-pink-500 hover:bg-pink-600 text-white font-bold py-4 px-8 rounded-full transition-colors w-full"
          >
            <RefreshCw className="h-5 w-5" />
            <span>Try Again</span>
          </button>
        </div>
      </div>
    )
  }

  // Loading state
  if (!cameraReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-white text-xl">Setting up camera...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm mx-auto">
        {/* Video Preview */}
        <div className="relative bg-black rounded-3xl overflow-hidden shadow-2xl mb-8">
          {/* Hidden video element */}
          <video ref={videoRef} autoPlay muted playsInline className="hidden" />

          {/* Canvas for recording */}
          <canvas ref={canvasRef} className="w-full aspect-[9/16] bg-black" />

          {/* Live preview overlay (not recorded) */}
          {isRecording && currentOverlay && (
            <div
              className="absolute bottom-24 left-1/2 transform -translate-x-1/2 px-8 py-4 rounded-full text-center transition-all duration-500"
              style={{
                backgroundColor: currentOverlay.bgColor,
                color: currentOverlay.color,
              }}
            >
              <p className="text-2xl font-bold">{currentOverlay.text}</p>
            </div>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-6 left-6 flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-white font-semibold">REC</span>
            </div>
          )}

          {/* Timer */}
          {isRecording && (
            <div className="absolute top-6 right-6 bg-black bg-opacity-50 text-white font-bold text-xl px-4 py-2 rounded-full">
              {timeLeft}s
            </div>
          )}

          {/* Processing overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-white text-lg font-semibold">Processing video...</p>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="text-center">
          {/* Error message */}
          {error && (
            <div className="mb-4 p-4 bg-red-500 bg-opacity-20 border border-red-500 rounded-lg">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Success state */}
          {downloadUrl ? (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-green-400 font-semibold mb-4">Video recorded successfully!</p>
                <p className="text-gray-400 text-sm mb-4">Your video has been automatically downloaded.</p>
              </div>
              <button
                onClick={resetApp}
                className="flex items-center justify-center space-x-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold py-4 px-8 rounded-full transition-all w-full"
              >
                <Camera className="h-6 w-6" />
                <span>Record Another</span>
              </button>
            </div>
          ) : (
            <>
              {/* Main record button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`flex items-center justify-center space-x-3 font-bold py-6 px-12 rounded-full transition-all w-full text-xl ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white transform hover:scale-105"
                } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {isRecording ? (
                  <>
                    <Square className="h-8 w-8" />
                    <span>Stop Recording</span>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                      <div className="w-6 h-6 bg-red-500 rounded-full"></div>
                    </div>
                    <span>Start Recording</span>
                  </>
                )}
              </button>

              {/* Help text */}
              {!isRecording && (
                <p className="text-gray-400 mt-4 text-sm">
                  Tap to record a 15-second video with animated text overlays!
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
