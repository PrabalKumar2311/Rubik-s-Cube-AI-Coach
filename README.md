# 3D Rubik's Cube AI Coach

An interactive 3D Rubik's Cube with a built-in AI coach that helps users solve the cube step by step.

The cube can be rotated and manipulated directly, scrambled, solved, and reset. The solver generates the move sequence, while Gemini is used to explain the current step and answer questions about the solve.

## Live Demo

[Try the Rubik's Cube AI Coach]([YOUR_LIVE_LINK](https://rubix-cube-ai-coach.netlify.app))

## Features

- Interactive 3D Rubik's Cube
- Scramble, solve, undo and reset controls
- Step-by-step solution playback
- Animated cube moves
- AI Coach powered by Google Gemini
- Learn mode for beginner-friendly guidance
- Fastest mode for quicker solutions
- Ask questions about the current step
- Solver-backed hints when Gemini is unavailable
- Move counter and solve timer
- Responsive layout

## Tech Stack

- React
- React Three Fiber
- Three.js
- JavaScript
- Google Gemini API
- Vite

## How It Works

The cube maintains its own state while the solver generates the moves required to reach the solved state.

When a solution is available, each move can be played back directly on the 3D cube. The AI Coach sits on top of this system and explains the steps in a more understandable way.

For example:

```text
Cube State
    ↓
Solver
    ↓
Solution Moves
    ↓
3D Move Animation
    ↓
Updated Cube State
