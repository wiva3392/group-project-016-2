// *****************************************************
// Import Dependencies
// *****************************************************
const express = require("express");
const handlebars = require("express-handlebars");
const path = require("path");
const pgp = require("pg-promise")();
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const app = express();

// *****************************************************
// Handlebars Configuration
// *****************************************************
const hbs = handlebars.create({
  extname: "hbs",
  layoutsDir: false,
  partialsDir: path.join(__dirname, "partials"),
  defaultLayout: false,
});

hbs.handlebars.registerHelper("eq", (a, b) => a === b);

// *****************************************************
// Database Configuration
// *****************************************************
const dbConfig = {
  connectionString: process.env.DATABASE_URL || buildConnectionString(),
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
};

function buildConnectionString() {
  const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT,
  } = process.env;

  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB || !POSTGRES_HOST) {
    throw new Error("Database environment variables are missing.");
  }

  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${
    POSTGRES_PORT || 5432
  }/${POSTGRES_DB}`;
}

const db = pgp(dbConfig);

// Initialize Database Tables
async function initializeDatabase() {
  try {
    await db.connect();
    console.log("Database connection successful");

    await db.none(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    await db.none(`
      CREATE TABLE IF NOT EXISTS movies (
        movie_id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL UNIQUE,
        release_year INT
      )
    `);

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

    await db.none(`
      CREATE TABLE IF NOT EXISTS user_list (
        list_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        movie_id INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
        UNIQUE (user_id, movie_id)
      )
    `);

    console.log("All tables initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

initializeDatabase();

// *****************************************************
// Express Configuration
// *****************************************************
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "pages"));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-secret-key",
    saveUninitialized: false,
    resave: false,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

// *****************************************************
// Helper Functions
// *****************************************************
async function fetchMoviesByTitle(apiKey, title) {
  try {
    const response = await axios.get("http://www.omdbapi.com/", {
      params: { apikey: apiKey, s: title },
      timeout: 5000,
    });

    if (response.data.Response === "False") {
      return [];
    }

    return (response.data.Search || []).slice(0, 10).map((movie) => ({
      Title: movie.Title,
      Year: movie.Year,
      Poster: movie.Poster !== "N/A" ? movie.Poster : null,
      imdbID: movie.imdbID,
      url: `https://www.imdb.com/title/${movie.imdbID}`,
    }));
  } catch (error) {
    console.error(`Error fetching ${title}:`, error.message);
    return [];
  }
}

async function fetchPopularMovies(apiKey) {
  // List of popular movie searches to simulate "trending"
  const popularSearches = [
    "Avengers",
    "Batman",
    "Spider",
    "Star Wars",
    "Harry Potter",
  ];

  const allMovies = [];

  for (const search of popularSearches) {
    const movies = await fetchMoviesByTitle(apiKey, search);
    allMovies.push(...movies);
  }

  // Remove duplicates and return first 50
  const uniqueMovies = allMovies.filter(
    (movie, index, self) =>
      index === self.findIndex((m) => m.imdbID === movie.imdbID)
  );

  return uniqueMovies.slice(0, 50);
}

async function fetchTop10Movies(apiKey) {
  // Most watched/popular movie titles
  const top10Titles = [
    "The Shawshank Redemption",
    "The Godfather",
    "The Dark Knight",
    "Inception",
    "Interstellar",
    "Pulp Fiction",
    "Fight Club",
    "Forrest Gump",
    "The Matrix",
    "Goodfellas",
  ];

  const movies = [];

  for (const title of top10Titles) {
    try {
      const response = await axios.get("http://www.omdbapi.com/", {
        params: { apikey: apiKey, t: title },
        timeout: 5000,
      });

      if (response.data.Response !== "False") {
        movies.push({
          Title: response.data.Title,
          Year: response.data.Year,
          Poster: response.data.Poster !== "N/A" ? response.data.Poster : null,
          imdbID: response.data.imdbID,
          imdbRating: response.data.imdbRating,
          url: `https://www.imdb.com/title/${response.data.imdbID}`,
        });
      }
    } catch (error) {
      console.error(`Error fetching ${title}:`, error.message);
    }
  }

  return movies;
}

// *****************************************************
// Middleware
// *****************************************************
const isJsonRequest = (req) =>
  req.is("application/json") ||
  req.headers["content-type"] === "application/json";

const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
};

// *****************************************************
// Public Routes
// *****************************************************
app.get("/", (req, res) => res.redirect("/login"));

app.get("/welcome", (req, res) => {
  res.json({ status: "success", message: "Welcome!" });
});

// Register Routes
app.get("/register", (req, res) => {
  res.render("register", { message: null });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      const message = "Username and password are required.";
      return isJsonRequest(req)
        ? res.status(400).json({ message })
        : res.render("register", { message });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.none("INSERT INTO users (username, password) VALUES ($1, $2)", [
      username,
      hash,
    ]);

    console.log(`New user registered: ${username}`);

    return isJsonRequest(req)
      ? res.status(200).json({ message: "User registered successfully" })
      : res.redirect("/login");
  } catch (err) {
    console.error("Registration failed:", err);

    const message =
      err.code === "23505" || /unique/i.test(err.message)
        ? "Username already exists. Please choose another."
        : "Registration failed. Please try again later.";

    return isJsonRequest(req)
      ? res.status(err.code === "23505" ? 400 : 500).json({ message })
      : res.render("register", { message });
  }
});

// Login Routes
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      const message = "Username and password are required.";
      return isJsonRequest(req)
        ? res.status(400).json({ message })
        : res.render("login", { message });
    }

    const user = await db.oneOrNone("SELECT * FROM users WHERE username = $1", [
      username,
    ]);

    if (!user) {
      const message = "User not found. Please register first.";
      return isJsonRequest(req)
        ? res.status(401).json({ message })
        : res.render("login", { message });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      const message = "Incorrect username or password.";
      return isJsonRequest(req)
        ? res.status(401).json({ message })
        : res.render("login", { message });
    }

    req.session.user = user;
    req.session.save();

    console.log(`User logged in: ${user.username}`);

    return isJsonRequest(req)
      ? res
          .status(200)
          .json({ message: "Login successful", username: user.username })
      : res.redirect("/discover");
  } catch (error) {
    console.error("Login error:", error);
    const message = "Login failed. Please try again.";

    return isJsonRequest(req)
      ? res.status(500).json({ message })
      : res.render("login", { message });
  }
});

// *****************************************************
// Protected Routes (Authentication Required)
// *****************************************************
app.use(auth);

// Profile Page
app.get("/profile", async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const sort = req.query.sort || "rating_desc";

    const orderBy =
      sort === "rating_asc"
        ? "r.rating ASC, m.title ASC"
        : "r.rating DESC, m.title ASC";

    const sortLabel =
      sort === "rating_asc" ? "Lowest Rated First" : "Highest Rated First";

    const [watchlist, reviews, topMovies] = await Promise.all([
      db.any(
        `
        SELECT m.title, m.release_year
        FROM user_list ul
        JOIN movies m ON ul.movie_id = m.movie_id
        WHERE ul.user_id = $1
        ORDER BY m.title ASC
      `,
        [userId]
      ),

      db.any(
        `
        SELECT m.title, m.release_year, r.rating, r.review_text
        FROM reviews r
        JOIN movies m ON r.movie_id = m.movie_id
        WHERE r.user_id = $1
        ORDER BY ${orderBy}
      `,
        [userId]
      ),

      db.any(
        `
        SELECT m.title, m.release_year, AVG(r.rating) AS avg_rating, COUNT(*) AS review_count
        FROM reviews r
        JOIN movies m ON r.movie_id = m.movie_id
        WHERE r.user_id = $1
        GROUP BY m.movie_id, m.title, m.release_year
        ORDER BY AVG(r.rating) DESC, COUNT(*) DESC, m.title ASC
        LIMIT 10
      `,
        [userId]
      ),
    ]);

    res.render("profile", {
      username: req.session.user.username,
      watchlist,
      reviews,
      topMovies,
      sort,
      sortLabel,
    });
  } catch (err) {
    console.error("Error loading profile:", err.message);
    res.redirect("/discover");
  }
});

// Discover Page - Enhanced with Popular Movies and Top 10
app.get("/discover", async (req, res) => {
  try {
    const apiKey = process.env.API_KEY;
    const searchQuery = req.query.title;

    if (!apiKey) {
      return res.render("discover", {
        username: req.session.user?.username,
        results: [],
        popularMovies: [],
        top10Movies: [],
        message: "OMDB API key not configured.",
      });
    }

    let results = [];
    let popularMovies = [];
    let top10Movies = [];
    let message = null;

    if (searchQuery) {
      // User searched for something specific
      const response = await axios.get("http://www.omdbapi.com/", {
        params: { apikey: apiKey, s: searchQuery },
      });

      if (response.data.Response === "False") {
        message = "No movies found for your search.";
      } else {
        results = (response.data.Search || []).map((movie) => ({
          Title: movie.Title,
          Year: movie.Year,
          Poster: movie.Poster !== "N/A" ? movie.Poster : null,
          imdbID: movie.imdbID,
          url: `https://www.imdb.com/title/${movie.imdbID}`,
        }));
      }
    } else {
      // Default page load - show popular movies and top 10
      [popularMovies, top10Movies] = await Promise.all([
        fetchPopularMovies(apiKey),
        fetchTop10Movies(apiKey),
      ]);
    }

    res.render("discover", {
      username: req.session.user?.username,
      results,
      popularMovies,
      top10Movies,
      message,
      isSearch: !!searchQuery,
    });
  } catch (err) {
    console.error("OMDB API Error:", err.message);
    res.render("discover", {
      username: req.session.user?.username,
      results: [],
      popularMovies: [],
      top10Movies: [],
      message: "Error loading movies. Try again later.",
    });
  }
});

// Add Movie to Watchlist
app.post("/movies/add", async (req, res) => {
  try {
    const { title, year } = req.body;
    const userId = req.session.user.user_id;

    const movie = await db.one(
      `INSERT INTO movies (title, release_year)
       VALUES ($1, $2)
       ON CONFLICT (title) DO UPDATE SET release_year = EXCLUDED.release_year
       RETURNING movie_id`,
      [title, year]
    );

    await db.none(
      `INSERT INTO user_list (user_id, movie_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, movie_id) DO NOTHING`,
      [userId, movie.movie_id]
    );

    console.log(`Movie added to user ${userId}: ${title}`);
    res.redirect("/discover");
  } catch (err) {
    console.error("Error adding movie:", err.message);
    res.redirect("/discover");
  }
});

// Review Routes
app.get("/reviews/new", (req, res) => {
  res.render("review", {
    username: req.session.user?.username,
    title: req.query.title,
  });
});

app.post("/reviews/add", async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const { title, rating, review_text } = req.body;

    let movie = await db.oneOrNone(
      "SELECT movie_id FROM movies WHERE title = $1",
      [title]
    );

    if (!movie) {
      movie = await db.one(
        "INSERT INTO movies (title) VALUES ($1) RETURNING movie_id",
        [title]
      );
    }

    await db.none(
      "INSERT INTO reviews (user_id, movie_id, rating, review_text) VALUES ($1, $2, $3, $4)",
      [userId, movie.movie_id, rating, review_text]
    );

    console.log(`Review added for ${title}`);
    res.redirect("/discover");
  } catch (err) {
    console.error("Error adding review:", err.message);
    res.redirect("/discover");
  }
});

app.get("/reviews", async (req, res) => {
  try {
    const { title } = req.query;

    if (!title) {
      return res.redirect("/discover");
    }

    const movie = await db.oneOrNone(
      "SELECT movie_id FROM movies WHERE title = $1",
      [title]
    );

    const reviews = movie
      ? await db.any(
          `SELECT r.rating, r.review_text, u.username
           FROM reviews r
           JOIN users u ON r.user_id = u.user_id
           WHERE r.movie_id = $1`,
          [movie.movie_id]
        )
      : [];

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

// Logout
app.get("/logout", (req, res) => {
  const username = req.session.user?.username;
  req.session.destroy((err) => {
    if (err) console.error("Error destroying session:", err);
    console.log(`User logged out: ${username}`);
  });
  res.render("logout");
});

// *****************************************************
// Start Server
// *****************************************************
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
  });
}

module.exports = app;
