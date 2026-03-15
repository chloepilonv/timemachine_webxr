# Pair Coding Rules

The following rules apply when collaborating on this project:

## 1. Separation of Concerns
- **AI Agent & Voice Control:** The AI assistant (me) is strictly responsible for implementing, debugging, and maintaining the voice control flows, the AI model logic, and the `Convai.ai` integration (`convai-web-sdk`).
- **WebXR & Rendering:** Do **NOT** modify the WebXR world rendering, Gaussian Splat logic (`SparkJS`), performance optimizations, or the avatar instantiation (`@iwsdk/core` 3D objects). Another developer on the team is exclusively handling the world rendering and the 3D visual aspects of the avatar.

## 2. Code Modification Boundaries
- Do not make unsolicited changes to `gaussianSplatLoader.ts`, `gaussianSplatAnimator.ts`, `timeMachineSystem.ts`, or the core `Three.js` setup in `index.ts` unless it is explicitly and solely required to attach the audio context to the scene.
- If an integration point touches the avatar or world rendering, defer the implementation to the other developer or provide the voice/AI hooks for them to attach manually.

## 3. Pull Requests
- Keep Pull Requests scoped strictly to the AI/Voice feature (`feature/convai-integration`). Do not include formatting changes or refactors of the WebXR components.
