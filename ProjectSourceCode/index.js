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
  layoutsDir: false, // Disable layouts
  partialsDir: __dirname + "/partials",
  defaultLayout: false, // Don't use any layout
});

// database configuration
const dbConfig = {
  host: "db", // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(async (obj) => {
    console.log("Database connection successful");

    // Create users table if it doesn't exist
    await db.none(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);
    console.log("Users table ready");

    obj.done();
  })
  .catch((error) => {
    console.log("ERROR:", error.message || error);
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
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
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

// Discover page - Shows events from Ticketmaster
app.get("/discover", async (req, res) => {
  try {
    // Check if API key exists
    if (!process.env.API_KEY) {
      return res.render("discover", {
        username: req.session.user?.username,
        results: [],
        message: "API key not configured. Please contact administrator.",
      });
    }

    // Fetch events from Ticketmaster API
    const response = await axios({
      url: "https://app.ticketmaster.com/discovery/v2/events.json",
      method: "GET",
      dataType: "json",
      headers: {
        "Accept-Encoding": "application/json",
      },
      params: {
        apikey: process.env.API_KEY,
        keyword: "music",
        size: 12,
      },
    });

    const events = response.data._embedded?.events || [];

    // Map event data for display
    const results = events.map((event) => ({
      name: event.name,
      image: event.images?.[0]?.url || "/images/default-event.jpg",
      date: event.dates?.start?.localDate || "Date TBD",
      time: event.dates?.start?.localTime || "Time TBD",
      url: event.url,
    }));

    res.render("discover", {
      username: req.session.user?.username,
      results,
      message: null,
    });
  } catch (error) {
    console.error("Error fetching events:", error.message);

    res.render("discover", {
      username: req.session.user?.username,
      results: [],
      message: "Failed to load events. Please try again later.",
    });
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
