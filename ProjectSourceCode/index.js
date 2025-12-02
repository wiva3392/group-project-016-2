// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require("express"); // To build an application server or API
const app = express();
const handlebars = require("express-handlebars");
const Handlebars = require("handlebars");
const path = require("path");
const pgp = require("pg-promise")(); // To connect to the Postgres DB from the node server
const bodyParser = require("body-parser");
const session = require("express-session"); // To set the session object
const bcrypt = require("bcryptjs"); // To hash passwords
const axios = require("axios"); // To make HTTP requests

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: "hbs",
  layoutsDir: false,
  partialsDir: __dirname + "/partials",
  defaultLayout: false,
});

// Build a connection string:
// - Prefer DATABASE_URL (Render, or local .env).
// - Otherwise, build from POSTGRES_* env vars.
// - If neither is set, throw an error instead of silently using 'db'.
let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT,
  } = process.env;

  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB || !POSTGRES_HOST) {
    throw new Error(
      "Database env vars missing. Need POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST or DATABASE_URL."
    );
  }

  const port = POSTGRES_PORT || 5432;

  connectionString =
    `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}` +
    `@${POSTGRES_HOST}:${port}/${POSTGRES_DB}`;
}

const db = pgp({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// test your database
db.connect()
  .then(async (obj) => {
    console.log("Database connection successful");

    // Create users table
    await db.none(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);
    console.log("Users table ready");

    // Create movies table
    await db.none(`
      CREATE TABLE IF NOT EXISTS movies (
        movie_id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        release_year INT
      )
    `);

    console.log("Movies table ready");

    // Create reviews table
    await db.none(`
      CREATE TABLE IF NOT EXISTS reviews (
        review_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        movie_id INT NOT NULL,
        rating INT CHECK (rating BETWEEN 1 AND 10),
        review_text CHAR(200),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE
      )
    `);
    console.log("Reviews table ready");

    obj.done();
  })
  .catch((error) => {
    console.log("ERROR connecting to database:", error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "pages")); // Using pages folder directly
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret:
      process.env.SESSION_SECRET || "fallback-secret-key-change-in-production",
    saveUninitialized: false,
    resave: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

// Helper function to check if request is JSON
const isJsonRequest = (req) => {
  return (
    req.is("application/json") ||
    req.headers["content-type"] === "application/json"
  );
};

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Root route - redirect to login
app.get("/", (req, res) => {
  res.redirect("/login");
});

// Welcome route for testing
app.get("/welcome", (req, res) => {
  res.json({ status: "success", message: "Welcome!" });
});

// Register - GET route
app.get("/register", (req, res) => {
  res.render("register", { message: null });
});

// Register - POST route with validation (supports both JSON and form data)
app.post("/register", async (req, res) => {
  try {
    // Validate input
    if (!req.body.username || !req.body.password) {
      const message = "Username and password are required.";

      if (isJsonRequest(req)) {
        return res.status(400).json({ message });
      }
      return res.render("register", { message });
    }

    // Hash password
    const hash = await bcrypt.hash(req.body.password, 10);

    // Insert user into database
    const query = `
      INSERT INTO users (username, password)
      VALUES ($1, $2)
    `;
    await db.none(query, [req.body.username, hash]);

    console.log(`New user registered: ${req.body.username}`);

    // Return JSON for API tests, redirect for browser
    if (isJsonRequest(req)) {
      return res.status(200).json({ message: "User registered successfully" });
    }
    return res.redirect("/login");
  } catch (err) {
    console.error("Registration failed:", err);

    // Check for duplicate username error
    if (err.code === "23505" || /unique/i.test(err.message)) {
      const message = "Username already exists. Please choose another.";

      if (isJsonRequest(req)) {
        return res.status(400).json({ message });
      }
      return res.render("register", { message });
    }

    // Generic error
    const message = "Registration failed. Please try again later.";

    if (isJsonRequest(req)) {
      return res.status(500).json({ message });
    }
    return res.render("register", { message });
  }
});

// Login - GET route
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

// Login - POST route
app.post("/login", async (req, res) => {
  try {
    // Validate input
    if (!req.body.username || !req.body.password) {
      const message = "Username and password are required.";

      if (isJsonRequest(req)) {
        return res.status(400).json({ message });
      }
      return res.render("login", { message });
    }

    // Find user in database
    const user = await db.oneOrNone("SELECT * FROM users WHERE username = $1", [
      req.body.username,
    ]);

    // Check if user exists
    if (!user) {
      const message = "User not found. Please register first.";

      if (isJsonRequest(req)) {
        return res.status(401).json({ message });
      }
      return res.render("login", { message });
    }

    // Compare password with hash
    const match = await bcrypt.compare(req.body.password, user.password);

    if (!match) {
      const message = "Incorrect username or password.";

      if (isJsonRequest(req)) {
        return res.status(401).json({ message });
      }
      return res.render("login", { message });
    }

    // Save user to session
    req.session.user = user;
    req.session.save();

    console.log(`User logged in: ${user.username}`);

    if (isJsonRequest(req)) {
      return res.status(200).json({
        message: "Login successful",
        username: user.username,
      });
    }
    return res.redirect("/discover");
  } catch (error) {
    console.error("Login error:", error);
    const message = "Login failed. Please try again.";

    if (isJsonRequest(req)) {
      return res.status(500).json({ message });
    }
    return res.render("login", { message });
  }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
// All routes below this require authentication

const auth = (req, res, next) => {
  if (!req.session.user) {
    // User not logged in - redirect to login page
    return res.redirect("/login");
  }
  next();
};

// Apply authentication to all routes below
app.use(auth);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Discover page - Shows events from OMDB
app.get("/discover", async (req, res) => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return res.render("discover", {
        username: req.session.user?.username,
        results: [],
        message: "OMDB API key not configured.",
      });
    }

    const searchQuery = req.query.title || "The Avengers"; // default search

    const response = await axios.get("http://www.omdbapi.com/", {
      params: {
        apikey: apiKey,
        s: searchQuery, // <-- search for multiple results
      },
    });

    if (response.data.Response === "False") {
      return res.render("discover", {
        username: req.session.user?.username,
        results: [],
        message: "No movies found.",
      });
    }

    const movies = response.data.Search || [];

    // Map to your Handlebars structure
    const results = movies.map((movie) => ({
      Title: movie.Title,
      Year: movie.Year,
      Poster:
        movie.Poster !== "N/A" ? movie.Poster : "/images/default-movie.jpg",
      imdbID: movie.imdbID, // keep this for future DB insertion
      url: `https://www.imdb.com/title/${movie.imdbID}`,
    }));

    res.render("discover", {
      username: req.session.user?.username,
      results,
      message: null,
    });
  } catch (err) {
    console.error("OMDB API Error:", err.message);
    res.render("discover", {
      username: req.session.user?.username,
      results: [],
      message: "Error loading movies. Try again later.",
    });
  }
});

// Add movie to DB
app.post("/movies/add", async (req, res) => {
  try {
    const { title, year } = req.body;

    // Insert movie into DB, avoid duplicates
    await db.none(
      `INSERT INTO movies (title, release_year)
       VALUES ($1, $2)
       ON CONFLICT (title) DO NOTHING`,
      [title, year]
    );

    console.log(`Movie added: ${title}`);
    res.redirect("/discover");
  } catch (err) {
    console.error("Error adding movie:", err.message);
    res.redirect("/discover");
  }
});

// Show review form
app.get("/reviews/new", (req, res) => {
  const { title } = req.query;

  res.render("review", {
    username: req.session.user?.username,
    title,
  });
});

// Save review to DB
app.post("/reviews/add", async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const { title, rating, review_text } = req.body;

    // Find movie in DB
    let movie = await db.oneOrNone(
      `SELECT movie_id FROM movies WHERE title = $1`,
      [title]
    );

    // Insert movie if not exists
    if (!movie) {
      movie = await db.one(
        `INSERT INTO movies (title) VALUES ($1) RETURNING movie_id`,
        [title]
      );
    }

    // Insert review
    await db.none(
      `INSERT INTO reviews (user_id, movie_id, rating, review_text)
       VALUES ($1, $2, $3, $4)`,
      [userId, movie.movie_id, rating, review_text]
    );

    console.log(`Review added for ${title}`);
    res.redirect("/discover");
  } catch (err) {
    console.error("Error adding review:", err.message);
    res.redirect("/discover");
  }
});

// Read reviews for a movie
app.get("/reviews", async (req, res) => {
  try {
    const { title } = req.query;

    if (!title) {
      return res.redirect("/discover");
    }

    // Get movie info
    const movie = await db.oneOrNone(
      `SELECT movie_id FROM movies WHERE title = $1`,
      [title]
    );

    let reviews = [];

    if (movie) {
      reviews = await db.any(
        `SELECT r.rating, r.review_text, u.username
         FROM reviews r
         JOIN users u ON r.user_id = u.user_id
         WHERE r.movie_id = $1`,
        [movie.movie_id]
      );
    }

    res.render("read-review", {
      username: req.session.user?.username,
      title,
      reviews,
      message:
        reviews.length === 0
          ? "No reviews yet — be the first to add one!"
          : null,
    });
  } catch (err) {
    console.error("Error fetching reviews:", err.message);
    res.redirect("/discover");
  }
});

// Logout route
app.get("/logout", (req, res) => {
  const username = req.session.user?.username;

  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
    console.log(`User logged out: ${username}`);
  });

  res.render("logout");
});

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
  });
}

// Export the app for testing
module.exports = app;
