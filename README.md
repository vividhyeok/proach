# Proach - AI Pitch Coach (React Version)

Proach is an AI-powered pitch coach that helps you improve your public speaking skills. This version is a complete rewrite using a modern web stack. It records your voice, transcribes it using ElevenLabs' Speech-to-Text API, and displays the result.

This project was refactored from a Python backend to a client-side single-page application.

## Tech Stack

- **Frontend:** [React](https://react.dev/)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Speech-to-Text:** [ElevenLabs API](https://elevenlabs.io/)

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- An [ElevenLabs API Key](https://elevenlabs.io/docs/api-reference/authentication)

## Setup and Installation

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <repository-url>
    cd proach
    ```

2.  **Install dependencies:**
    This command will install all the necessary packages defined in `package.json`.
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a new file named `.env` in the root of the project directory by copying the example file.
    ```bash
    cp .env.example .env
    ```
    Open the `.env` file and add your ElevenLabs API key.
    ```
    VITE_ELEVENLABS_API_KEY="<your_elevenlabs_api_key>"
    ```
    **Important:** This is a client-side application, and the API key will be exposed in the browser. This setup is suitable for development purposes only. For production, you should use a backend proxy to protect your API key.

## Running the Application

Once the dependencies are installed and your environment variables are set, you can start the development server.

```bash
npm run dev
```

This will start the Vite development server, and you can access the application at `http://localhost:5173` (the port may vary).

## How to Use

1.  Open the application in your browser.
2.  Click the "Start Recording" button. Your browser will ask for microphone permission.
3.  Speak your pitch or practice your speech.
4.  Click the "Stop Recording" button.
5.  The application will process the audio and display the transcription on the screen.