import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import Cube from "./Cube";
import AICoach from "./ai/AICoach.jsx";
import { Sun, Moon, CircleQuestionMark } from "lucide-react";

function formatTime(ms) {
  const total = Math.floor(ms / 10);
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Slides the rendered view sideways so the cube stays visible next to the coach panel
function ViewShift({ px }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const current = useRef(0);
  useFrame((_, dt) => {
    current.current += (px - current.current) * (1 - Math.exp(-dt * 8));
    if (px === 0 && Math.abs(current.current) < 0.5) {
      current.current = 0;
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    camera.setViewOffset(
      size.width,
      size.height,
      current.current,
      0,
      size.width,
      size.height,
    );
  });
  return null;
}

export default function App() {
  const cube = useRef(null);
  const [stats, setStats] = useState({
    moves: 0,
    solved: true,
    canUndo: false,
    canSolve: false,
  });
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const closeCoach = useCallback(() => setCoachOpen(false), []);
  const [darkMode, setDarkMode] = useState(true);

  const toggleTheme = () => {
    setDarkMode((prev) => !prev);
  };

  // session: armed after a scramble, timer starts on first move, stops on solve
  const session = useRef({ armed: false, start: 0 });

  const handleChange = useCallback((s) => {
    setStats(s);
    const ses = session.current;
    if (ses.armed && !ses.start && s.moves > 0) {
      ses.start = performance.now();
      setRunning(true);
    }
    if (ses.armed && ses.start && s.solved) {
      const time = performance.now() - ses.start;
      setElapsed(time);
      setRunning(false);
      setResult({ moves: s.moves, time });
      session.current = { armed: false, start: 0 };
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setElapsed(performance.now() - session.current.start),
      33,
    );
    return () => clearInterval(id);
  }, [running]);

  const scramble = useCallback(() => {
    if (cube.current?.scramble()) {
      session.current = { armed: true, start: 0 };
      setRunning(false);
      setElapsed(0);
      setResult(null);
    }
  }, []);

  const stopSession = () => {
    session.current = { armed: false, start: 0 };
    setRunning(false);
  };

  const solve = useCallback(() => {
    if (cube.current?.solve()) {
      stopSession();
      setResult(null);
    }
  }, []);

  const reset = useCallback(() => {
    stopSession();
    setElapsed(0);
    setResult(null);
    cube.current?.reset();
  }, []);

  const undo = useCallback(() => cube.current?.undo(), []);

  useEffect(() => {
    const onKey = (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.code === "KeyH") {
        setCoachOpen((v) => !v);
      } else if (e.code.startsWith("Key")) {
        const letter = e.code.slice(3);
        if ("RLUDFBMESXYZ".includes(letter))
          cube.current?.move(letter, e.shiftKey);
      } else if (e.code === "Space") {
        e.preventDefault();
        scramble();
      } else if (e.code === "Backspace") {
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scramble, undo]);

  return (
    <div
      className={`app ${coachOpen ? "coach-open" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas camera={{ position: [7, 6, 9], fov: 38 }} dpr={[1, 2]}>
        <color
          attach="background"
          args={darkMode ? ["#101216"] : ["#f0f0f0"]}
        />
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 9, 7]} intensity={1.3} />
        <directionalLight position={[-6, -4, -5]} intensity={0.35} />
        <Environment resolution={256}>
          <Lightformer
            form="rect"
            intensity={2.2}
            position={[0, 6, 0]}
            rotation-x={Math.PI / 2}
            scale={[10, 10, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1.2}
            position={[-6, 1, 3]}
            rotation-y={Math.PI / 2}
            scale={[8, 4, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1.2}
            position={[6, 1, 3]}
            rotation-y={-Math.PI / 2}
            scale={[8, 4, 1]}
          />
          <Lightformer
            form="ring"
            intensity={1.5}
            position={[2, 2, 8]}
            scale={3}
          />
        </Environment>

        <Cube ref={cube} onChange={handleChange} />
        <ViewShift
          px={
            coachOpen &&
            typeof window !== "undefined" &&
            window.innerWidth > 760
              ? 210
              : 0
          }
        />

        <ContactShadows
          position={[0, -2.4, 0]}
          opacity={0.5}
          scale={12}
          blur={2.8}
          far={4}
        />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.8}
          // minDistance={5}
          // maxDistance={16}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />
      </Canvas>

       {/* Top bar */}
      <header className="panel top">
        <div className="title">Rubik's Cube</div>
        <div className="stats">
          <div>
            <span className="label">Moves</span>
            <span className="value">{stats.moves}</span>
          </div>
          <div>
            <span className="label">Time</span>
            <span className="value mono">{formatTime(elapsed)}</span>
          </div>
        </div>
      </header>

      {result && (
        <div className="solved-banner">
          Solved in {result.moves} moves · {formatTime(result.time)}
        </div>
      )}

      {/* Bottom bar with controls*/}
      <nav className="panel toolbar">
        <button
          className="ai-btn"
          onClick={() => setCoachOpen((v) => !v)}
          aria-expanded={coachOpen}
        >
          ✦ AI Coach
        </button>
        <button onClick={scramble}>Scramble</button>
        <button onClick={undo} disabled={!stats.canUndo}>
          Undo
        </button>
        <button onClick={solve} disabled={!stats.canSolve || stats.solved}>
          Solve
        </button>
        <button onClick={reset}>Reset</button>
        <button
          className="ghost"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
        >
          <CircleQuestionMark size={20} />
        </button>

        <button
          className="ghost theme-toggle"
          onClick={toggleTheme}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </nav>

      <AICoach
        open={coachOpen}
        onClose={closeCoach}
        cubeRef={cube}
        stats={stats}
      />

      {helpOpen && (
        <aside className="panel help">
          <h3>Controls</h3>
          <ul>
            <li>
              <b>Drag a face</b> to turn that layer (flick for a quick turn)
            </li>
            <li>
              <b>Drag the background</b> or <b>right-drag</b> anywhere to orbit
            </li>
            <li>
              <b>Scroll / pinch</b> to zoom
            </li>
          </ul>
          <h3>Keyboard</h3>
          <ul>
            <li>
              <kbd>R</kbd> <kbd>L</kbd> <kbd>U</kbd> <kbd>D</kbd> <kbd>F</kbd>{" "}
              <kbd>B</kbd> face turns
            </li>
            <li>
              <kbd>M</kbd> <kbd>E</kbd> <kbd>S</kbd> slice turns · <kbd>X</kbd>{" "}
              <kbd>Y</kbd> <kbd>Z</kbd> rotate cube
            </li>
            <li>
              <kbd>Shift</kbd> + key for counter-clockwise (prime)
            </li>
            <li>
              <kbd>Space</kbd> scramble · <kbd>Ctrl/⌘ Z</kbd> undo
            </li>
            <li>
              <kbd>H</kbd> open the AI Coach
            </li>
          </ul>
        </aside>
      )}
    </div>
  );
}
