// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
});

// database configuration
const dbConfig = {
  host: 'db', // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
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

// TODO - Include your API routes here

// Register
app.get('/register', (req, res) => {
  res.render('pages/register');
});

app.post('/register', async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const query = `
      INSERT INTO users (username, password)
      VALUES ($1, $2)
    `;
    await db.none(query, [req.body.username, hash]);
    return res.redirect('/login');
    // had to add error handling in this, kept crashing my server during testing with repeat inserts of same name
  } catch (err) {
    console.error('Registration failed:', err);
    return res.render('pages/register', {
      message: 'Username already exists. Please choose another.'
    });
  }
});


// Login
app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [req.body.username]);

    if (!user) {
      return res.redirect('/register');
    }

    const match = await bcrypt.compare(req.body.password, user.password);

    if (!match) {
      return res.render('pages/login', {
        message: 'Incorrect username or password.'
      });
    }

    req.session.user = user;
    req.session.save();

    return res.redirect('/discover');
});


// Authentication Middleware.
const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.redirect('/login');
  }
  next();
};

// Authentication Required
app.use(auth);


// Discover
app.get('/discover', async (req, res) => {
  try {
    const response = await axios({
      url: 'https://app.ticketmaster.com/discovery/v2/events.json',
      method: 'GET',
      dataType: 'json',
      headers: {
        'Accept-Encoding': 'application/json',
      },
      params: {
        apikey: process.env.API_KEY,
        keyword: 'music',
        size: 12,
      },
    });

    const events = response.data._embedded?.events || [];

    // mapping out data to help in discover.hbs that's taking information directly from Tickermaster
    // ? to make more compact, if/else basically to check if each value is valid or not. || is used if it is not
    const results = events.map(event => ({
      name: event.name,
      image: event.images?.[0]?.url || '/images/default-event.jpg',
      date: event.dates?.start?.localDate || 'Date TBD',
      time: event.dates?.start?.localTime || 'Time TBD',
      url: event.url,
    }));

    res.render('pages/discover', {
      username: req.session.user?.username,
      results,
      message: null,
    });
  } catch (error) {
    console.error('Error fetching events:', error.message);
    res.render('pages/discover', {
      results: [],
      message: 'Failed to load events. Please try again later.',
    });
  }
});


// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();

  res.render('pages/logout');
});


// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');
