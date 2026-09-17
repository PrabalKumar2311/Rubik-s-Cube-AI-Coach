# 3D Rubik's Cube AI Coach

An interactive 3D Rubik's Cube with a solver-backed AI coach that helps users solve the cube step by step.

The cube can be manipulated directly, scrambled, solved, and reset. Solution steps can also be played back on the 3D cube, so users can actually see each move being performed.

## Live Demo

🔗 [Try the Rubik's Cube AI Coach](https://rubix-cube-ai-coach.netlify.app/)

## Screenshots

### AI Coach

<img width="2048" height="1272" alt="image" src="https://github.com/user-attachments/assets/bccf6177-4193-4dc8-90c2-9be905a051ee" />

### 3D Cube

<img width="2048" height="1070" alt="image" src="https://github.com/user-attachments/assets/7c3d45ff-9873-4d69-8178-53804d882a47" />

## Features

- Interactive 3D Rubik's Cube
- Scramble, solve, undo and reset
- Step-by-step solution playback
- Animated cube moves
- AI Coach powered by Google Gemini
- Beginner-friendly Learn mode
- Fastest solving mode
- Ask questions about the current solving step
- Solver-backed hints when AI is unavailable
- Move counter and solve timer
- Responsive interface

## Tech Stack

- React
- React Three Fiber
- Three.js
- JavaScript
- Google Gemini API
- Vite

## How It Works

The cube maintains its own state while the solver generates the moves required to reach the solved state.

Each solution move can then be played directly on the 3D cube. The cube updates its internal state while the corresponding layer is animated visually.

```text
Cube State
    ↓
Solver
    ↓
Solution Moves
    ↓
3D Move Animation
    ↓
Updated Cube State<img width="2048" height="1272" alt="Screenshot 2026-09-17 at 11 18 14 AM" src="https://github.com/user-attachments/assets/2514c260-bbab-428b-bb1f-db02bd1fc877" />
