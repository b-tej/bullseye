console.log("sketch.js loaded at", new Date().toISOString());

const SIMILARITY_LOW = 0.35;
const SIMILARITY_HIGH = 0.62;
const SIMILARITY_POWER = 1.65;
const CENTER_RING_SCORE = 0.50;
const INNER_RADIUS_POWER = 0.55;
const OUTER_RADIUS_POWER = 1.15;
const TARGET_MAGNET_START = 0.15;
const OUTER_RING_EXTRA = 300;
const DARTBOARD_OUTER_SCALE = 1.18;
const ANIMATE_OUTBOUND_GUESSES = true;
const OUTBOUND_THROW_DURATION = 800;
const OUTBOUND_THROW_START_SIZE = 110;
const OUTBOUND_THROW_ARC_LIFT = 180;
const ANIMATE_INBOUND_GUESSES = true;
const INBOUND_THROW_DURATION = 650;
const INBOUND_THROW_START_SIZE = 90;
const INBOUND_THROW_ARC_LIFT = 120;
const DEBUG_PROFILES = false;
const PUZZLE_DATA_FILE = "data/puzzle_embeddings_default.json";
const FALLBACK_PUZZLE_DATA_FILE = "data/puzzle_embeddings_panache.json";
const API_BASE_URL = (window.BULLSEYE_API_BASE_URL || "").replace(/\/$/, "");
const EMBED_API_URL = `${API_BASE_URL}/api/embed`;

// VISUAL STYLE: edit these values to redesign the game.
const STYLE = {
  background: [150, 75, 0],
  ring: [45, 58, 82, 90],
  ringFill: [45, 58, 82, 18],
  line: [125, 160, 190, 70],
  text: [235, 238, 245],
  mutedText: [155, 165, 185],
  center: [255, 244, 210],
  target: [218, 112, 38],
  targetBorder: [225, 214, 188],
  targetShadow: [70, 36, 16, 120],
  guess: [200, 220, 255],
  inboundGuess: [48, 97, 255],
  outboundGuess: [255, 92, 92],
  specialHit: [255, 205, 80],
  found: [255, 205, 80],
  labelBg: [18, 24, 38, 220],
  centerSize: 12,
  targetSize: 32,
  targetHitSize: 16,
  guessSize: 8,
  outboundGuessSize: 18,
  foundSize: 12,
  labelTextSize: 12,
  headerTextSize: 22,
};

let puzzleData;
let wordBank = {};
let profileBank = {};
let puzzle;
let nodes = [];
let guesses = [];
let foundTargets = new Set();
let guessCount = 0;
let currentMode = null;
let gameStarted = false;
let gameWon = false;
let guessInput;
let guessButton;
let startMenu;
let winMenu;
let winMessage;
let easyModeButton;
let hardModeButton;
let winRestartButton;
let viewBoardButton;
let restartButton;
let scoreButton;
let statusMessage = "";
let messageUntil = 0;
let bounds;
let loadState = "loading";
let loadError = "";
let guessInProgress = false;
let lastProfileSummary = "";
let debugMessage = "script loaded";
let outboundSwishPlayed = new Set();
let outboundThudPlayed = new Set();
let inboundSwishPlayed = new Set();
let inboundBoopPlayed = new Set();
let inboundCashPlayed = new Set();
let targetHitTimes = {};
let centerHitAt = null;
let winSequenceStarted = false;
let winSequenceTimers = [];
let boardFiberCache = null;

let woodTex;
let headerLogo;
let swish;
let thud;
let boop;
let cash;
let ding;
let yell;


function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  textFont("Arial");
  buildControls();
  const loading = document.getElementById("p5_loading");
  if (loading) {
    loading.remove();
  }
  loadPuzzleData();
}

function preload() {
  headerLogo = loadImage("images/header_logo.png");
  woodTex = loadImage("images/wood_texture.png");
  swish = loadSound('sounds/swish.mp3');
  thud = loadSound('sounds/thud.mp3');
  boop = loadSound('sounds/boop.mp3');
  cash = loadSound('sounds/cash.mp3');
  ding = createOptionalAudio("sounds/ding.mp3");
  yell = createOptionalAudio("sounds/yell.mp3");


  swish.setVolume(1);
  thud.setVolume(0.5);
  boop.setVolume(0.7);
  cash.setVolume(0.8);
}

function createOptionalAudio(path) {
  const audio = new Audio(path);
  audio.preload = "auto";
  return audio;
}

function drawWoodTexture() {
  imageMode(CORNER);
  tint(255, 70); // makes it subtle
  image(woodTex, 0, 0, width, height);
  noTint();
}

function draw() {
  background(...STYLE.background);

  if (loadState !== "ready") {
    drawLoadingState();
    // drawDebugOverlay();
    return;
  }
  drawDartboard();
  // drawBackground();
  drawHeader();
  // drawConstellation();
  drawNodes();
  // drawFooter();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  boardFiberCache = null;
  if (loadState === "ready") {
    preparePuzzle();
  }
}

function loadPuzzleData() {
  fetchPuzzleDataFile(PUZZLE_DATA_FILE)
    .then((response) => {
      const data = response.data;
      puzzleData = data;
      puzzle = buildPuzzle(puzzleData);
      wordBank = puzzleData.embeddings;
      profileBank = {};
      preparePuzzle();
      loadState = "ready";
      updateScoreButton();
      if (guessInput) {
        guessInput.disabled = !gameStarted || gameWon;
      }
      if (guessButton) {
        guessButton.disabled = !gameStarted || gameWon;
      }
    })
    .catch((error) => {
      loadState = "error";
      loadError = error.message;
    });
}

function fetchPuzzleDataFile(path) {
  return fetch(path).then((response) => {
    if (!response.ok) {
      if (path !== FALLBACK_PUZZLE_DATA_FILE) {
        return fetchPuzzleDataFile(FALLBACK_PUZZLE_DATA_FILE);
      }
      throw new Error(`Could not load embeddings JSON (${response.status})`);
    }

    return response.json().then((data) => ({ data, path }));
  });
}

function buildPuzzle(data) {
  return {
    date: data.date,
    model: data.model,
    center: {
      ...data.center,
      vector: data.embeddings[data.center.word],
    },
    targets: data.targets.map((target) => ({
      ...target,
      vector: data.embeddings[target.word],
    })),
  };
}

function drawLoadingState() {
  noStroke();
  fill(236, 239, 232);
  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(width < 560 ? 18 : 24);
  text("Play Bullseye!", width / 2, height / 2 - 34);

  fill(154, 167, 190);
  textSize(14);
  if (loadState === "error") {
    text(`Could not load ${PUZZLE_DATA_FILE}`, width / 2, height / 2 + 2);
    textSize(12);
    text(loadError, width / 2, height / 2 + 28);
    text("Open the project through http://localhost:8000/index.html", width / 2, height / 2 + 54);
  } else {
    text("Loading embeddings...", width / 2, height / 2 + 2);
  }
}

function drawDebugOverlay() {
  noStroke();
  fill(255, 230, 120);
  textAlign(LEFT, TOP);
  textStyle(NORMAL);
  textSize(12);
  text(`debug: ${debugMessage}`, 12, 12);
}

function keyPressed() {
  if (keyCode === ENTER) {
    submitGuess();
  }
}

function preparePuzzle() {
  const marginX = 18;
  const top = 78;
  const bottom = 68;
  bounds = {
    left: marginX,
    right: width - marginX,
    top,
    bottom: height - bottom,
  };

  const centerNode = makeNode(puzzle.center.word, puzzle.center.vector, "center");
  centerNode.profileIndex = 0;
  centerNode.x = width / 2;
  centerNode.y = (bounds.top + bounds.bottom) / 2.25;

  nodes = [centerNode];
  for (let i = 0; i < puzzle.targets.length; i++) {
    const target = puzzle.targets[i];
    const node = makeNode(target.word, target.vector, "target");
    node.profileIndex = i + 1;
    node.hint = target.hint;
    nodes.push(node);
  }

  for (const guess of guesses) {
    const guessNode = makeNode(guess.word, guess.vector, guess.kind, guess.profile);
    guessNode.thrownAt = guess.thrownAt;
    nodes.push(guessNode);
  }

  projectNodes();
}

function buildControls() {
  startMenu = document.getElementById("start-menu");
  winMenu = document.getElementById("win-menu");
  winMessage = document.getElementById("win-message");
  easyModeButton = document.getElementById("easy-mode-button");
  hardModeButton = document.getElementById("hard-mode-button");
  winRestartButton = document.getElementById("win-restart-button");
  viewBoardButton = document.getElementById("view-board-button");
  restartButton = document.getElementById("restart-button");
  scoreButton = document.getElementById("score-button");
  guessInput = document.getElementById("guess-input");
  guessButton = document.getElementById("guess-button");
  guessInput.disabled = true;
  guessButton.disabled = true;

  easyModeButton.addEventListener("click", () => startGame("easy"));
  hardModeButton.addEventListener("click", () => startGame("hard"));
  winRestartButton.addEventListener("click", restartGame);
  viewBoardButton.addEventListener("click", hideWinMenu);
  restartButton.addEventListener("click", restartGame);
  guessButton.addEventListener("click", submitGuess);
  guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitGuess();
    }
  });
  updateScoreButton();
}

function startGame(mode) {
  unlockGameAudio();
  clearWinSequence();
  hideWinMenu();
  currentMode = mode;
  gameStarted = true;
  gameWon = false;
  guesses = [];
  outboundSwishPlayed = new Set();
  outboundThudPlayed = new Set();
  inboundSwishPlayed = new Set();
  inboundBoopPlayed = new Set();
  inboundCashPlayed = new Set();
  targetHitTimes = {};
  centerHitAt = null;
  winSequenceStarted = false;
  foundTargets = new Set();
  guessCount = 0;
  statusMessage = "";
  messageUntil = 0;
  lastProfileSummary = "";
  updateScoreButton();

  if (startMenu) {
    startMenu.classList.add("is-hidden");
  }

  if (loadState === "ready") {
    guessInput.disabled = false;
    guessButton.disabled = false;
    guessInput.focus();
    preparePuzzle();
    showMessage(
      currentMode === "easy"
        ? "Targets are visible. Guess the center word."
        : "Targets are hidden too. Guess targets for hints, or solve the center."
    );
  }
}

function restartGame() {
  clearWinSequence();
  hideWinMenu();
  gameStarted = false;
  gameWon = false;
  guesses = [];
  outboundSwishPlayed = new Set();
  outboundThudPlayed = new Set();
  inboundSwishPlayed = new Set();
  inboundBoopPlayed = new Set();
  inboundCashPlayed = new Set();
  targetHitTimes = {};
  centerHitAt = null;
  winSequenceStarted = false;
  foundTargets = new Set();
  guessCount = 0;
  currentMode = null;
  statusMessage = "";
  messageUntil = 0;
  lastProfileSummary = "";
  updateScoreButton();

  if (guessInput) {
    guessInput.value = "";
    guessInput.disabled = true;
  }
  if (guessButton) {
    guessButton.disabled = true;
  }
  if (startMenu) {
    startMenu.classList.remove("is-hidden");
  }
  if (loadState === "ready") {
    preparePuzzle();
  }
}

function updateScoreButton() {
  if (scoreButton) {
    scoreButton.textContent = `Guesses: ${guessCount}`;
  }
}

function unlockGameAudio() {
  if (typeof userStartAudio === "function") {
    userStartAudio();
  }
}

function scheduleWinSequence() {
  clearWinSequence();
  winSequenceStarted = true;
  winSequenceTimers.push(setTimeout(() => {
    playSoundOnce(ding);
    playSoundOnce(yell);
  }, INBOUND_THROW_DURATION + 520));
  winSequenceTimers.push(setTimeout(showWinMenu, INBOUND_THROW_DURATION + 1250));
}

function clearWinSequence() {
  for (const timer of winSequenceTimers) {
    clearTimeout(timer);
  }
  winSequenceTimers = [];
}

function showWinMenu() {
  if (!gameWon || !winMenu) {
    return;
  }

  if (winMessage && puzzle) {
    winMessage.textContent = `The Bullseye of the Day was "${puzzle.center.word}".`;
  }
  winMenu.classList.remove("is-hidden");
}

function hideWinMenu() {
  if (winMenu) {
    winMenu.classList.add("is-hidden");
  }
}

async function submitGuess() {
  if (loadState !== "ready") {
    showMessage("The word map is still loading.");
    return;
  }

  if (!gameStarted) {
    showMessage("Choose a mode to start.");
    return;
  }

  if (gameWon) {
    showMessage("You already found the center word. Restart for a new run.");
    return;
  }

  if (guessInProgress) {
    return;
  }

  const rawGuess = guessInput.value;
  console.log("rawGuess:", rawGuess);
  debugMessage = `rawGuess: ${rawGuess}`;
  const word = normalizeWord(rawGuess);

  if (!word) {
    showMessage("Try a word first.");
    return;
  }

  if (guesses.some((guess) => guess.word === word) || foundTargets.has(word)) {
    showMessage("Already mapped.");
    guessInput.value = "";
    return;
  }

  guessCount += 1;
  updateScoreButton();

  if (word === puzzle.center.word) {
    gameWon = true;
    centerHitAt = millis();
    scheduleWinSequence();
    guessInput.value = "";
    guessInput.disabled = true;
    guessButton.disabled = true;
    showMessage(`You found the center word in ${guessCount} ${guessCount === 1 ? "guess" : "guesses"}.`, 9000);
    preparePuzzle();
    return;
  }

  const target = puzzle.targets.find((item) => item.word === word);

  if (target) {
    foundTargets.add(word);
    targetHitTimes[word] = millis();
    updateScoreButton();
    showMessage(
      currentMode === "hard"
        ? `Target found: ${word}. Keep looking for the center.`
        : `${word} is a target, not the center.`
    );
  } else {
    guessInProgress = true;
    guessInput.disabled = true;
    guessButton.disabled = true;
    showMessage(`Finding ${word} on the map...`);

    try {
      const guessData = await getGuessData(word);
      guesses.push({
        word,
        vector: guessData.vector,
        profile: guessData.profile,
        kind: "guess",
        thrownAt: millis(),
      });
      lastProfileSummary = describeProfile(word, guessData.profile);
      showMessage(lastProfileSummary, 6500);
    } catch (error) {
      showMessage(error.message, 6500);
      guessInProgress = false;
      guessInput.disabled = false;
      guessButton.disabled = false;
      return;
    }

    guessInProgress = false;
    guessInput.disabled = false;
    guessButton.disabled = false;
  }

  guessInput.value = "";
  if (!gameWon) {
    guessInput.focus();
  }
  preparePuzzle();
}

async function getGuessData(word) {
  if (wordBank[word]) {
    return {
      vector: wordBank[word],
      profile: getSemanticProfile(word, wordBank[word]),
    };
  }

  const response = await fetch(EMBED_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ word }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not embed that word.");
  }

  wordBank[data.word] = data.embedding;
  profileBank[data.word] = sanitizeProfile(
    data.word,
    data.profile ? profileObjectToArray(data.profile) : null,
    data.embedding
  );
  return {
    vector: data.embedding,
    profile: profileBank[data.word],
  };
}

function projectNodes() {
  const center = nodes[0];
  const targetNodes = nodes.filter((node) => node.kind === "target");
  const targetRadius = getTargetRingRadius();
  const targetAngles = getTargetAngles();

  targetNodes.forEach((node, index) => {
    const angle = targetAngles[index % targetAngles.length];
    node.angle = angle;
    node.x = center.x + cos(angle) * targetRadius;
    node.y = center.y + sin(angle) * targetRadius;
  });

  const placed = [center, ...targetNodes];

  for (const node of nodes) {
    if (node.kind === "center" || node.kind === "target") {
      continue;
    }

    const radial = getRadialGuessPosition(node, center, targetRadius, targetAngles);
    const scattered = addSmallJitter(node, radial);
    const repelled = repelFromNeighbors(scattered, placed, 56);
    const visiblePosition = keepGuessVisible(repelled);
    node.x = visiblePosition.x;
    node.y = visiblePosition.y;
    if (DEBUG_PROFILES) {
      logProfile(node.word, node.profile, node.debugPlacement);
    }
    placed.push(node);
  }

  for (const node of nodes) {
    if (node.kind === "guess") {
      continue;
    }

    node.x = constrain(node.x, bounds.left, bounds.right);
    node.y = constrain(node.y, bounds.top, bounds.bottom);
  }
}

function getTargetRingRadius() {
  const mapWidth = bounds.right - bounds.left;
  const mapHeight = bounds.bottom - bounds.top;
  return min(mapWidth, mapHeight) * 0.42;
}

function getDartboardOuterRadius() {
  return getTargetRingRadius() * DARTBOARD_OUTER_SCALE;
}

function getDartboardCenter() {
  return {
    x: width / 2,
    y: (bounds.top + bounds.bottom) / 2.25,
  };
}

function keepGuessVisible(position) {
  return {
    x: constrain(position.x, bounds.left, bounds.right),
    y: constrain(position.y, bounds.top, bounds.bottom),
  };
}

function getTargetAngles() {
  return [
    -HALF_PI,
    0,
    HALF_PI,
    PI,
  ];
}

function getRadialGuessPosition(node, center, targetRadius, targetAngles) {
  const centerScore = getProfileSimilarity(node, center);
  const centerStrength = scaleSimilarity(centerScore);
  const targetScores = puzzle.targets.map((target, index) => ({
    index,
    word: target.word,
    score: node.profile[index + 1],
    strength: scaleSimilarity(node.profile[index + 1]),
    angle: targetAngles[index],
  }));

  targetScores.sort((a, b) => b.strength - a.strength);
  const primary = targetScores[0];
  const secondary = targetScores[1];
  const direction = getWeightedTargetDirection(targetScores);
  const gap = primary.strength - secondary.strength;
  const secondaryRatio = primary.strength > 0
    ? secondary.strength / primary.strength
    : 0;
  const semanticAngle = direction.magnitude > 0.04
    ? direction.angle
    : primary.angle;
  const randomAngle = getStableRandomAngle(node.word);
  const magnetAmount = constrain(
    map(primary.strength, TARGET_MAGNET_START, 1, 0, 1),
    0,
    1
  );
  const angle = lerpAngle(randomAngle, semanticAngle, magnetAmount);
  const innerRadius = targetRadius * 0.26;
  const outerRadius = getOuterRadiusFromScreen(targetRadius);
  const radius = getDartboardRadius(centerScore, targetRadius, innerRadius, outerRadius);

  node.debugPlacement = {
    centerScore,
    centerStrength,
    primary: primary.word,
    primaryScore: primary.score,
    primaryStrength: primary.strength,
    secondary: secondary.word,
    secondaryScore: secondary.score,
    secondaryStrength: secondary.strength,
    secondaryRatio,
    directionMagnitude: direction.magnitude,
    directionWeights: direction.weights,
    magnetAmount,
    semanticAngle,
    randomAngle,
    gap,
    radius,
    targetRadius,
    outerRadius,
    ringScore: CENTER_RING_SCORE,
  };

  return {
    x: center.x + cos(angle) * radius,
    y: center.y + sin(angle) * radius,
  };
}

function getWeightedTargetDirection(targetScores) {
  let x = 0;
  let y = 0;
  const weights = {};

  for (const target of targetScores) {
    const weight = pow(target.strength, 3);
    weights[target.word] = weight;
    x += cos(target.angle) * weight;
    y += sin(target.angle) * weight;
  }

  const magnitude = sqrt(x * x + y * y);

  return {
    angle: atan2(y, x),
    magnitude,
    weights,
  };
}

function getStableRandomAngle(word) {
  return map(wordHash(word) % 10000, 0, 10000, 0, TWO_PI);
}

function getOuterRadiusFromScreen(targetRadius) {
  return targetRadius + OUTER_RING_EXTRA;
}

function getDartboardRadius(centerScore, targetRadius, innerRadius, outerRadius) {
  if (centerScore >= CENTER_RING_SCORE) {
    const inside = constrain(
      map(centerScore, CENTER_RING_SCORE, SIMILARITY_HIGH, 0, 1),
      0,
      1
    );
    const easedInside = pow(inside, INNER_RADIUS_POWER);
    return lerp(targetRadius, innerRadius, easedInside);
  }

  const outside = constrain(
    map(centerScore, SIMILARITY_LOW, CENTER_RING_SCORE, 1, 0),
    0,
    1
  );
  const easedOutside = pow(outside, OUTER_RADIUS_POWER);
  return lerp(targetRadius, outerRadius, easedOutside);
}

function scaleSimilarity(score) {
  const normalized = constrain(
    map(score, SIMILARITY_LOW, SIMILARITY_HIGH, 0, 1),
    0,
    1
  );
  return pow(normalized, SIMILARITY_POWER);
}

function addSmallJitter(node, position) {
  const hash = wordHash(node.word);
  const angle = map(hash % 10000, 0, 10000, 0, TWO_PI);
  const amount = map((hash >> 9) % 10000, 0, 10000, 2, 8);

  return {
    x: position.x + cos(angle) * amount,
    y: position.y + sin(angle) * amount,
  };
}

function lerpAngle(a, b, amount) {
  const difference = atan2(sin(b - a), cos(b - a));
  return a + difference * amount;
}

function repelFromNeighbors(position, placed, minDistance) {
  const point = createVector(position.x, position.y);

  for (let pass = 0; pass < 8; pass++) {
    for (const other of placed) {
      const delta = p5.Vector.sub(point, createVector(other.x, other.y));
      const distance = max(delta.mag(), 0.01);

      if (distance < minDistance) {
        delta.setMag((minDistance - distance) * 0.42);
        point.add(delta);
      }
    }
  }

  return { x: point.x, y: point.y };
}

function wordHash(word) {
  let hash = 2166136261;

  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function drawBackground() {
  const centerY = (bounds.top + bounds.bottom) / 2;
  fill(...STYLE.ringFill);
  stroke(...STYLE.ring);
  strokeWeight(1);

  circle(width / 2, centerY, getTargetRingRadius() * 2);
  circle(width / 2, centerY, getTargetRingRadius() * 0.52);
}

function drawDartboard() {
  const boardCenter = getDartboardCenter();
  const cx = boardCenter.x;
  const cy = boardCenter.y;
  const R = getTargetRingRadius(); // your outer playable radius

  // proportions based on the premade board
  const outerBlack = getDartboardOuterRadius(); // because original black circle was 400 while board ring was 320
  const ring1Outer = R * 1.00;     // 320 -> base
  const ring1Inner = R * 0.9375;   // 300 / 320
  const ring2Outer = R * 0.625;    // 200 / 320
  const ring2Inner = R * 0.5625;   // 180 / 320
  const outerBull = R * 0.09375;   // 30 / 320
  const innerBull = R * 0.03906;   // 12.5 / 320

  // optional wood-like background
  background(110, 71, 33);
  drawWoodTexture();

  drawBoardDropShadow(cx, cy, outerBlack);

  // black outer circle
  noStroke();
  fill(12, 12, 11);
  circle(cx, cy, outerBlack * 2);
  drawInsetRingShadow(cx, cy, outerBlack, 18, 45);

  // segment rings
  for (let a = 0; a < 20; a++) {
    let color1, color2;

    if (a % 2 === 0) {
      color1 = color(24, 115, 48);      // softer green
      color2 = color(214, 202, 171);    // aged sisal
    } else {
      color1 = color(156, 32, 34);      // softer red
      color2 = color(22, 20, 18);       // warm black
    }

    const start = a * PI / 10 - PI / 20;
    const end = a * PI / 10 + PI / 20;

    fill(color1);
    arc(cx, cy, ring1Outer * 2, ring1Outer * 2, start, end, PIE);

    fill(color2);
    arc(cx, cy, ring1Inner * 2, ring1Inner * 2, start, end, PIE);

    fill(color1);
    arc(cx, cy, ring2Outer * 2, ring2Outer * 2, start, end, PIE);

    fill(color2);
    arc(cx, cy, ring2Inner * 2, ring2Inner * 2, start, end, PIE);
  }

  drawBoardWireDividers(cx, cy, {
    ring1Outer,
    ring1Inner,
    ring2Outer,
    ring2Inner,
    outerBull,
    innerBull,
  });

  // bullseye
  fill(24, 115, 48);
  circle(cx, cy, outerBull * 2);

  drawInsetRingShadow(cx, cy, outerBull, 5, 35);

  fill(156, 32, 34);
  circle(cx, cy, innerBull * 2);
  drawBoardWireDividers(cx, cy, {
    ring1Outer,
    ring1Inner,
    ring2Outer,
    ring2Inner,
    outerBull,
    innerBull,
  });
}

function drawBoardDropShadow(cx, cy, radius) {
  drawingContext.save();
  drawingContext.shadowBlur = 34;
  drawingContext.shadowColor = "rgba(0, 0, 0, 0.58)";
  drawingContext.shadowOffsetX = 0;
  drawingContext.shadowOffsetY = 14;
  noStroke();
  fill(0, 0, 0, 185);
  circle(cx, cy, radius * 2);
  drawingContext.restore();
}

function drawInsetRingShadow(cx, cy, radius, widthAmount, alpha) {
  noFill();
  stroke(0, 0, 0, alpha);
  strokeWeight(widthAmount);
  circle(cx, cy, max(0, radius * 2 - widthAmount));
}

function drawBoardWireDividers(cx, cy, board) {
  stroke(220, 214, 192, 145);
  strokeWeight(1.35);
  noFill();

  circle(cx, cy, board.ring1Outer * 2);
  circle(cx, cy, board.ring1Inner * 2);
  circle(cx, cy, board.ring2Outer * 2);
  circle(cx, cy, board.ring2Inner * 2);
  circle(cx, cy, board.outerBull * 2);
  circle(cx, cy, board.innerBull * 2);

  for (let a = 0; a < 20; a++) {
    const angle = a * PI / 10 - PI / 20;
    line(
      cx + cos(angle) * board.outerBull,
      cy + sin(angle) * board.outerBull,
      cx + cos(angle) * board.ring1Outer,
      cy + sin(angle) * board.ring1Outer
    );
  }

  stroke(0, 0, 0, 90);
  strokeWeight(0.8);
  circle(cx, cy, board.ring1Inner * 2 - 3);
  circle(cx, cy, board.ring2Inner * 2 - 3);
}

function drawBoardFiber(cx, cy, radius) {
  if (!boardFiberCache || abs(boardFiberCache.radius - radius) > 0.5) {
    boardFiberCache = buildBoardFiberCache(radius);
  }

  strokeWeight(0.8);

  for (const fiber of boardFiberCache.fibers) {
    stroke(245, 238, 205, fiber.alpha);
    line(
      cx + fiber.x1,
      cy + fiber.y1,
      cx + fiber.x2,
      cy + fiber.y2
    );
  }
}

function buildBoardFiberCache(radius) {
  const fibers = [];
  randomSeed(12);

  for (let i = 0; i < 220; i++) {
    const angle = random(TWO_PI);
    const startRadius = random(radius * 0.12, radius * 0.98);
    const length = random(5, 18);
    const endAngle = angle + random(-0.012, 0.012);
    fibers.push({
      x1: cos(angle) * startRadius,
      y1: sin(angle) * startRadius,
      x2: cos(endAngle) * (startRadius + length),
      y2: sin(endAngle) * (startRadius + length),
      alpha: random(18, 44),
    });
  }

  return { radius, fibers };
}


function drawHeader() {
  noStroke();

  imageMode(CORNER);
  const logoMargin = width < 560 ? 14 : 24;
  const logoWidth = constrain(width * 0.30, 220, 390);
  const aspect = headerLogo.height / headerLogo.width;

  image(
    headerLogo,
    logoMargin,
    logoMargin,
    logoWidth,
    logoWidth * aspect
  );

  if (gameWon) {
    text(`${puzzle.center.word.toUpperCase()}: ${puzzle.center.note}`, width / 2, 80);
  } else if (currentMode === "easy") {

  } else {
  }
}

function drawConstellation() {
  const visibleNodes = nodes.filter((node) => node.kind !== "target" || shouldRevealTarget(node.word));
  const hiddenTargets = nodes.filter((node) => node.kind === "target" && !shouldRevealTarget(node.word));
  const center = nodes[0];

  for (const target of hiddenTargets) {
    drawSimilarityLine(center, target, 60);
  }

  for (const guess of visibleNodes) {
    if (guess.kind === "center") {
      continue;
    }

    const closestTargets = nodes
      .filter((node) => node.kind === "target")
      .map((target) => ({
        target,
        similarity: getProfileSimilarity(guess, target),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 2);

    drawSimilarityLine(center, guess, 92);

    for (const pair of closestTargets) {
      drawSimilarityLine(guess, pair.target, 46);
    }
  }
}

function drawSimilarityLine(a, b, alpha) {
  stroke(...STYLE.line);
  strokeWeight(1);
  line(a.x, a.y, b.x, b.y);
}

function drawNodes() {
  const sortedNodes = [...nodes].sort((a, b) => nodeLayer(a) - nodeLayer(b));

  for (const node of sortedNodes) {
    if (node.kind === "target" && foundTargets.has(node.word)) {
      drawWordNode({ ...node, kind: "found" });
    } else {
      drawWordNode(node);
    }
  }
}

function drawWordNode(node) {
  if (node.kind === "guess") {
    drawGuessNode(node);
    return;
  }

  const isHiddenTarget = node.kind === "target" && !shouldRevealTarget(node.word);
  const isCenter = node.kind === "center";
  const isHiddenCenter = isCenter && !gameWon;
  const isFound = node.kind === "found";

  if (isCenter && gameWon) {
    drawSpecialHitNode(node, centerHitAt, node.word.toUpperCase());
    return;
  }

  if (node.kind === "target" || isFound) {
    drawTargetNode(node, {
      hidden: isHiddenTarget,
      hit: isFound,
    });
    return;
  }

  const size = isCenter
    ? STYLE.centerSize
    : STYLE.guessSize;

  noStroke();
  if (isCenter) {
    fill(...STYLE.center);
  } else {
    fill(...STYLE.guess);
  }
  circle(node.x, node.y, size);

  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(STYLE.labelTextSize);

  if (isHiddenCenter) {
    return;
  }

  const label = isCenter ? node.word.toUpperCase() : node.word;
  const labelWidth = textWidth(label) + 16;
  const labelHeight = 22;
  const labelY = node.y + 24;

  noStroke();
  fill(...STYLE.labelBg);
  rectMode(CENTER);
  rect(node.x, labelY, labelWidth, labelHeight, 4);

  fill(...STYLE.text);
  text(label, node.x, labelY);
}

function drawTargetNode(node, options) {
  const hitStartedAt = targetHitTimes[node.word];

  drawTargetBody(node.x, node.y);

  if (options.hit) {
    const progress = getThrowProgress(hitStartedAt, INBOUND_THROW_DURATION);
    playSpecialHitSounds(node, progress, hitStartedAt);

    if (ANIMATE_INBOUND_GUESSES && progress < 1) {
      drawThrowMark(node, progress, {
        startSize: INBOUND_THROW_START_SIZE,
        endSize: STYLE.targetHitSize,
        arcLift: INBOUND_THROW_ARC_LIFT,
        color: STYLE.specialHit,
      });
      return;
    }

    drawTargetHitCenter(node.x, node.y);
  }

  if (options.hidden) {
    fill(...STYLE.background);
    drawCenteredQuestionMark(node.x, node.y);
    return;
  }

  drawGuessLabel(node, STYLE.text, null, 34);
}

function drawTargetBody(x, y) {
  drawingContext.save();
  drawingContext.shadowBlur = 9;
  drawingContext.shadowColor = "rgba(0, 0, 0, 0.48)";
  drawingContext.shadowOffsetX = 2;
  drawingContext.shadowOffsetY = 3;
  noStroke();
  fill(...STYLE.targetShadow);
  circle(x + 1, y + 2, STYLE.targetSize);
  drawingContext.restore();

  noStroke();
  fill(...STYLE.target);
  circle(x, y, STYLE.targetSize);

  noFill();
  stroke(...STYLE.targetBorder);
  strokeWeight(1.8);
  circle(x, y, STYLE.targetSize - 2);

  stroke(0, 0, 0, 70);
  strokeWeight(3);
  circle(x, y, STYLE.targetSize - 8);
}

function drawTargetHitCenter(x, y) {
  drawDotAt(x, y, STYLE.targetHitSize, STYLE.specialHit);
}

function drawCenteredQuestionMark(x, y) {
  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(STYLE.labelTextSize);
  text("?", x, y);
}

function drawGuessNode(node) {
  if (isGuessOnBoard(node)) {
    drawInboundGuessNode(node);
  } else {
    drawOutboundGuessNode(node);
  }
}

function drawInboundGuessNode(node) {
  if (ANIMATE_INBOUND_GUESSES) {
    const progress = getThrowProgress(node.thrownAt, INBOUND_THROW_DURATION);
    playInboundGuessSounds(node, progress);

    if (progress < 1) {
      drawThrowMark(node, progress, {
        startSize: INBOUND_THROW_START_SIZE,
        endSize: STYLE.guessSize,
        arcLift: INBOUND_THROW_ARC_LIFT,
        color: STYLE.inboundGuess,
      });
      return;
    }
  }

  drawInboundMark(node);
  drawGuessLabel(node, STYLE.text);
}

function drawSpecialHitNode(node, thrownAt, labelOverride = null) {
  if (ANIMATE_INBOUND_GUESSES) {
    const progress = getThrowProgress(thrownAt, INBOUND_THROW_DURATION);
    playSpecialHitSounds(node, progress, thrownAt);

    if (progress < 1) {
      drawThrowMark(node, progress, {
        startSize: INBOUND_THROW_START_SIZE,
        endSize: STYLE.foundSize,
        arcLift: INBOUND_THROW_ARC_LIFT,
        color: STYLE.specialHit,
      });
      return;
    }
  }

  drawGuessDot(node, STYLE.specialHit, STYLE.foundSize);
  drawGuessLabel(node, STYLE.text, labelOverride);
}

function drawOutboundGuessNode(node) {
  if (ANIMATE_OUTBOUND_GUESSES) {
    const progress = getThrowProgress(node.thrownAt, OUTBOUND_THROW_DURATION);
    playOutboundThrowSounds(node, progress);

    if (progress < 1) {
      drawThrowMark(node, progress, {
        startSize: OUTBOUND_THROW_START_SIZE,
        endSize: STYLE.outboundGuessSize,
        arcLift: OUTBOUND_THROW_ARC_LIFT,
        color: STYLE.outboundGuess,
      });
      return;
    }
  }

  drawOutboundMark(node);
  drawGuessLabel(node, STYLE.outboundGuess);
}

function playOutboundThrowSounds(node, progress) {
  const soundKey = getThrowSoundKey(node);

  if (progress < 1 && !outboundSwishPlayed.has(soundKey)) {
    playSoundOnce(swish);
    outboundSwishPlayed.add(soundKey);
  }

  if (progress >= 1 && !outboundThudPlayed.has(soundKey)) {
    playSoundOnce(thud);
    outboundThudPlayed.add(soundKey);
  }
}

function playInboundGuessSounds(node, progress) {
  const soundKey = getThrowSoundKey(node);

  if (progress < 1 && !inboundSwishPlayed.has(soundKey)) {
    playSoundOnce(swish);
    inboundSwishPlayed.add(soundKey);
  }

  if (progress >= 1 && !inboundBoopPlayed.has(soundKey)) {
    playSoundOnce(boop);
    inboundBoopPlayed.add(soundKey);
  }
}

function playSpecialHitSounds(node, progress, thrownAt) {
  const soundKey = `${node.word}-${thrownAt || 0}`;

  if (progress < 1 && !inboundSwishPlayed.has(soundKey)) {
    playSoundOnce(swish);
    inboundSwishPlayed.add(soundKey);
  }

  if (progress >= 1 && !inboundCashPlayed.has(soundKey)) {
    playSoundOnce(cash);
    inboundCashPlayed.add(soundKey);
  }
}

function getThrowSoundKey(node) {
  return `${node.word}-${node.thrownAt || 0}`;
}

function playSoundOnce(sound) {
  if (!sound) {
    return;
  }

  if (typeof sound.isLoaded === "function" && !sound.isLoaded()) {
    return;
  }

  if (sound instanceof HTMLAudioElement) {
    sound.pause();
    sound.currentTime = 0;
    sound.play().catch(() => {});
    return;
  }

  if (typeof sound.stop === "function") {
    sound.stop();
  }

  if (typeof sound.play === "function") {
    sound.play();
  }
}

function drawGuessDot(node, fillColor, size) {
  drawDotAt(node.x, node.y, size, fillColor);
}

function drawDotAt(x, y, size, fillColor) {
  drawingContext.save();
  drawingContext.shadowBlur = 6;
  drawingContext.shadowColor = "rgba(0, 0, 0, 0.45)";
  drawingContext.shadowOffsetX = 1.5;
  drawingContext.shadowOffsetY = 2;
  noStroke();
  fill(...fillColor);
  circle(x, y, size);
  drawingContext.restore();
}

function drawOutboundMark(node) {
  drawOutboundMarkAt(node.x, node.y, STYLE.outboundGuessSize, 0);
}

function drawInboundMark(node) {
  drawInboundMarkAt(node.x, node.y, STYLE.outboundGuessSize, 0);
}

function drawOutboundMarkAt(x, y, size, rotation) {
  drawMarkAt(x, y, size, rotation, STYLE.outboundGuess);
}

function drawInboundMarkAt(x, y, size, rotation) {
  drawMarkAt(x, y, size, rotation, STYLE.inboundGuess);
}

function drawMarkAt(x, y, size, rotation, markColor) {
  drawingContext.save();
  drawingContext.shadowBlur = 7;
  drawingContext.shadowColor = "rgba(0, 0, 0, 0.5)";
  drawingContext.shadowOffsetX = 2;
  drawingContext.shadowOffsetY = 3;
  push();
  translate(x, y);
  rotate(rotation);
  stroke(...markColor);
  strokeWeight(3);
  const halfSize = size / 2;
  line(-halfSize, -halfSize, halfSize, halfSize);
  line(halfSize, -halfSize, -halfSize, halfSize);
  pop();
  drawingContext.restore();
}

function drawThrowMark(node, progress, options) {
  const eased = easeOutCubic(progress);
  const start = getThrowStart(node);
  const lift = sin(progress * PI) * -options.arcLift;
  const throwX = lerp(start.x, node.x, eased);
  const throwY = lerp(start.y, node.y, eased) + lift;
  const throwSize = lerp(options.startSize, options.endSize, eased);
  const rotation = lerp(-0.55, 0.12, eased) + sin(progress * TWO_PI) * 0.12;

  drawMarkAt(throwX, throwY, throwSize, rotation, options.color);
}

function isOutboundThrowAnimating(node) {
  return getThrowProgress(node.thrownAt, OUTBOUND_THROW_DURATION) < 1;
}

function getThrowProgress(thrownAt, duration) {
  if (typeof thrownAt !== "number") {
    return 1;
  }

  return constrain((millis() - thrownAt) / duration, 0, 1);
}

function getThrowStart(node) {
  const boardCenter = getDartboardCenter();
  const startDistance = min(width, height) * 0.34;
  const angle = atan2(node.y - boardCenter.y, node.x - boardCenter.x);

  return {
    x: boardCenter.x - cos(angle) * startDistance,
    y: height - 86,
  };
}

function easeOutCubic(value) {
  return 1 - pow(1 - value, 3);
}

function drawGuessLabel(node, textColor, labelOverride = null, labelOffset = 24) {
  textStyle(NORMAL);
  textSize(STYLE.labelTextSize);
  const label = labelOverride || node.word;
  const labelWidth = textWidth(label) + 16;
  const labelHeight = 22;
  const labelY = node.y + labelOffset;

  noStroke();
  fill(...STYLE.labelBg);
  rectMode(CENTER);
  rect(node.x, labelY, labelWidth, labelHeight, 4);

  fill(...textColor);
  textAlign(CENTER, CENTER);
  text(label, node.x, labelY);
}

function isGuessOnBoard(node) {
  const boardCenter = getDartboardCenter();
  const dx = node.x - boardCenter.x;
  const dy = node.y - boardCenter.y;
  return sqrt(dx * dx + dy * dy) <= getDartboardOuterRadius();
}

function drawFooter() {
  const controlsHeight = 54;
  noStroke();
  fill(0, 0, 0, 120);
  rectMode(CORNER);
  rect(0, height - controlsHeight, width, controlsHeight);

  const found = foundTargets.size;
  const total = puzzle.targets.length;
  const message = millis() < messageUntil
    ? statusMessage
    : gameStarted
      ? "Every guess maps another clue. The center word wins."
      : "Choose easy or hard mode to begin.";

  fill(...STYLE.mutedText);
  textAlign(CENTER, CENTER);
  textSize(12);
  const targetStatus = currentMode === "hard" ? `${found}/${total} targets  |  ` : "";
  text(`${targetStatus}${message}`, width / 2, height - 12);

  if (gameWon) {
    fill(...STYLE.found);
    textSize(18);
    text(`Center found: ${puzzle.center.word}`, width / 2, bounds.bottom + 35);
  }
}

function shouldRevealTarget(word) {
  return currentMode === "easy" || foundTargets.has(word);
}

function makeNode(word, vector, kind, profile = null) {
  return {
    word,
    vector,
    profile: sanitizeProfile(word, profile, vector),
    kind,
    x: width / 2,
    y: height / 2,
  };
}

function getSemanticProfile(word, vector) {
  if (profileBank[word]) {
    return profileBank[word];
  }

  const profile = computeSemanticProfile(vector);
  profileBank[word] = profile;
  return profile;
}

function computeSemanticProfile(vector) {
  const profile = [cosineSimilarity(vector, puzzle.center.vector)];
  for (const target of puzzle.targets) {
    profile.push(cosineSimilarity(vector, target.vector));
  }

  return profile;
}

function profileObjectToArray(profile) {
  const anchorWords = [puzzle.center.word, ...puzzle.targets.map((target) => target.word)];
  return anchorWords.map((word) => profile[word]);
}

function sanitizeProfile(word, profile, vector) {
  const fallback = computeSemanticProfile(vector);
  const cleanProfile = [];

  for (let i = 0; i < fallback.length; i++) {
    const value = profile ? Number(profile[i]) : NaN;
    cleanProfile.push(Number.isFinite(value) ? value : fallback[i]);
  }

  profileBank[word] = cleanProfile;
  return cleanProfile;
}

function describeProfile(word, profile) {
  const anchorWords = [puzzle.center.word, ...puzzle.targets.map((target) => target.word)];
  const scores = anchorWords.map((anchorWord, index) => ({
    word: anchorWord,
    score: profile[index],
  }));
  const closest = scores.slice(1).sort((a, b) => b.score - a.score)[0];
  const centerScore = scores[0].score.toFixed(2);
  const closestScore = closest.score.toFixed(2);

  return `${word}: center ${centerScore}, closest target ${closest.word} ${closestScore}`;
}

function logProfile(word, profile, placement = null) {
  const anchorWords = [puzzle.center.word, ...puzzle.targets.map((target) => target.word)];
  const table = {};

  anchorWords.forEach((anchorWord, index) => {
    table[anchorWord] = {
      raw: Number(profile[index].toFixed(4)),
      scaled: Number(scaleSimilarity(profile[index]).toFixed(4)),
    };
  });

  console.group(`Semantic profile: ${word}`);
  console.table(table);
  if (placement) {
    console.log("placement:", {
      centerScore: Number(placement.centerScore.toFixed(4)),
      centerStrength: Number(placement.centerStrength.toFixed(4)),
      primary: placement.primary,
      primaryScore: Number(placement.primaryScore.toFixed(4)),
      primaryStrength: Number(placement.primaryStrength.toFixed(4)),
      secondary: placement.secondary,
      secondaryScore: Number(placement.secondaryScore.toFixed(4)),
      secondaryStrength: Number(placement.secondaryStrength.toFixed(4)),
      secondaryRatio: Number(placement.secondaryRatio.toFixed(4)),
      directionMagnitude: Number(placement.directionMagnitude.toFixed(4)),
      magnetAmount: Number(placement.magnetAmount.toFixed(4)),
      gap: Number(placement.gap.toFixed(4)),
      ringScore: Number(placement.ringScore.toFixed(4)),
      targetRadius: Number(placement.targetRadius.toFixed(2)),
      outerRadius: Number(placement.outerRadius.toFixed(2)),
      beyondTarget: Number((placement.radius - placement.targetRadius).toFixed(2)),
      radius: Number(placement.radius.toFixed(2)),
    });
    console.log("direction weights:", placement.directionWeights);
  }
  console.log("raw profile:", profile);
  console.groupEnd();
}

function getProfileSimilarity(node, anchor) {
  if (typeof anchor.profileIndex === "number" && node.profile) {
    const value = node.profile[anchor.profileIndex];
    return Number.isFinite(value) ? value : cosineSimilarity(node.vector, anchor.vector);
  }

  if (typeof node.profileIndex === "number" && anchor.profile) {
    const value = anchor.profile[node.profileIndex];
    return Number.isFinite(value) ? value : cosineSimilarity(node.vector, anchor.vector);
  }

  return cosineSimilarity(node.vector, anchor.vector);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (sqrt(magA) * sqrt(magB));
}

function nodeLayer(node) {
  if (node.kind === "target") return 1;
  if (node.kind === "guess") return 2;
  if (node.kind === "found") return 3;
  return 4;
}

function normalizeWord(value) {
  return value.trim().toLowerCase().replace(/[^a-z-]/g, "");
}

function showMessage(message, duration = 2800) {
  statusMessage = message;
  messageUntil = millis() + duration;
}
