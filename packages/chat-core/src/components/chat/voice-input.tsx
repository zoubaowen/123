import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff } from 'lucide-react'

interface SpeechRecognitionResult {
  transcript: string
  isFinal: boolean
}

interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognition
    }
    webkitSpeechRecognition?: {
      new (): SpeechRecognition
    }
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function isSpeechSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function createRecognition(): SpeechRecognition | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null
  const instance = new Ctor()
  instance.continuous = false
  instance.interimResults = true
  instance.lang = 'zh-CN'
  return instance
}

interface VoiceInputProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
}

export function VoiceInput({ onTranscript, disabled = false, className = '' }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    setIsSupported(isSpeechSupported())
  }, [])

  const handleResult = useCallback(
    (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }

      if (final) {
        onTranscript(final)
        setInterimText('')
      } else {
        setInterimText(interim)
      }
    },
    [onTranscript],
  )

  const startListening = useCallback(() => {
    const recognition = createRecognition()
    if (!recognition) return

    recognition.onresult = handleResult
    recognition.onerror = (_event) => {
      setIsListening(false)
      setInterimText('')
    }
    recognition.onend = () => {
      setIsListening(false)

      if (interimText) {
        onTranscript(interimText)
        setInterimText('')
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [handleResult, interimText, onTranscript])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)

    if (interimText) {
      onTranscript(interimText)
      setInterimText('')
    }
  }, [interimText, onTranscript])

  if (!isSupported) return null

  return (
    <button
      type="button"
      onClick={() => (isListening ? stopListening() : startListening())}
      disabled={disabled}
      className={`rounded-full h-5 w-5 flex items-center justify-center transition-all duration-200 ${
        isListening ? 'bg-red-500 text-white animate-pulse' : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
      title={isListening ? '停止录音' : '语音输入'}
    >
      {isListening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
    </button>
  )
}
