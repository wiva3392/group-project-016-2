// ********************** Initialize server **********************************

const server = require("../index"); // Make sure the path to your index.js is correctly added

// ********************** Import Libraries ***********************************

const chai = require("chai"); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require("chai-http");
chai.should();
chai.use(chaiHttp);
const { assert, expect } = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe("Server!", () => {
  // Sample test case given to test / endpoint.
  it("Returns the default welcome message", (done) => {
    chai
      .request(server)
      .get("/welcome")
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals("success");
        assert.strictEqual(res.body.message, "Welcome!");
        done();
      });
  });
});

// *********************** TODO: WRITE 2 UNIT TESTCASES **************************

// Positive Test Case - Register a new user
describe("Testing Add User API", () => {
  it("Positive: /register should successfully create a new user", (done) => {
    chai
      .request(server)
      .post("/register")
      .send({
        username: "testuser_" + Date.now(),
        password: "testpassword123",
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body).to.have.property("message");
        done();
      });
  });
});

// Negative Test Case - Register with missing password
describe("Testing Add User API - Negative", () => {
  it("Negative: /register should return 400 when password is missing", (done) => {
    chai
      .request(server)
      .post("/register")
      .send({
        username: "testuser123",
        // Missing password
      })
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.message).to.include("required");
        done();
      });
  });
});

// *********************** Testing Redirect **************************

describe("Testing Redirect", () => {
  // Test case to check if /discover redirects to /login when not authenticated
  it("/discover route should redirect to /login with 302 HTTP status code", (done) => {
    chai
      .request(server)
      .get("/discover")
      .redirects(0) // Don't follow redirects automatically
      .end((err, res) => {
        res.should.have.status(302); // Expecting a redirect status code
        res.should.redirectTo(/\/login$/); // Should redirect to /login
        done();
      });
  });
});

// *********************** Testing Duplicate Username **************************

describe("Testing Duplicate Username", () => {
  // Test case to verify that registering with a duplicate username returns an error
  it("Negative: /register should return 400 when username already exists", (done) => {
    const duplicateUsername = "duplicate_test_user_" + Date.now();

    // First, create a user
    chai
      .request(server)
      .post("/register")
      .send({
        username: duplicateUsername,
        password: "password123",
      })
      .end((err, res) => {
        expect(res).to.have.status(200);

        // Now try to register the same username again
        chai
          .request(server)
          .post("/register")
          .send({
            username: duplicateUsername,
            password: "differentpassword",
          })
          .end((err, res) => {
            expect(res).to.have.status(400);
            expect(res.body.message).to.include("already exists");
            done();
          });
      });
  });
});
