# Card Radius Adjustment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase the visual roundness of the album and image cards to the approved "B" direction without changing card layout or interaction behavior.

**Architecture:** Keep the change constrained to shared card radius values and the two card components that render those shells. Add narrow component tests that assert the intended outer card radius and folder preview tile radius so future tuning stays explicit.

**Tech Stack:** React, MUI, Jest, Testing Library

---

### Task 1: Lock the desired radius in tests

**Files:**
- Create: `tests/unit/components/CardRadius.test.jsx`

- [ ] **Step 1: Write failing tests for the approved radius values**
- [ ] **Step 2: Run the targeted Jest file and confirm it fails for the current implementation**

### Task 2: Apply the approved radius values in shared config and card components

**Files:**
- Modify: `src/renderer/utils/layoutConfig.js`
- Modify: `src/renderer/components/AlbumCard.js`
- Modify: `src/renderer/components/ImageCard.js`

- [ ] **Step 1: Move the chosen outer and inner radius values into shared layout config**
- [ ] **Step 2: Update album and image cards to consume explicit pixel values from shared config**
- [ ] **Step 3: Keep the rest of card sizing, hover, and content behavior unchanged**

### Task 3: Verify and preview

**Files:**
- Test: `tests/unit/components/CardRadius.test.jsx`

- [ ] **Step 1: Re-run the targeted Jest file and confirm it passes**
- [ ] **Step 2: Start the development app with `npm start` for visual verification**
