# Final Project - Movie Meter

Hiale Haile, Killian Wood, William Vance, Abeneazer Getachew

CSCI3308 Fall 2025

## Overview

Our group wanted to create a streamlined and easy way to review movies and to add movies to a watchlist, so we created Movie Meter. Movie Meter utilizes node.js, a third party API for movies, and a PostgreSQL database to store movies and users’ reviews. It features a login and registration page in order for users to securely access their movies and reviews. This leads into a discovery page where users can find and review movies. If users want to add a movie to their watch list, each movie has an “add movie” button that moves it to their watchlist. Also, with each movie are “review” and “read” buttons. The “review” button brings users to a page that will allow them to score a movie on a scale of 1 through 10. Then below this is a text box where users can leave a typed out review to go with their score. The “read” button allows users to see their review and the reviews of other users. Finally the profile page shows users their watchlist, reviews, and their top movies based on their highest reviews. In the backend, all of this runs on  a relational database that stores users’ movies and reviews in tables.


## Run Instructions:
1. cd group-project-016-2/ProjectSourceCode/
2. sudo docker compose up (must have a .env set up)
3. open in browser "http://localhost:3000/login"
4. use the buttons to register, login, and discover the pages
5. sudo docker compose down

  .env (needed for docker to run)
  <!-- database credentials -->
  POSTGRES_USER="postgres" <br>
  POSTGRES_PASSWORD="pwd" <br>
  POSTGRES_DB="users_db" <br>
  POSTGRES_HOST=db
  
  <!-- Node vars -->
  SESSION_SECRET="super duper secret!" <br>
  API_KEY="bfa35873"

  **OR**

  render cloud link: https://movie-meter-xlqs.onrender.com/


## Directory structure explanation:
  * MilestoneSubmissions
    * submitted pdf files
    
  * ProjectSourceCode
    * init_data
      * create sql database
      * image of how the database is setup
    * node_modules (needed to run docker)
    * pages
      * handlebars pages used to render webpages
    * src
      * none
    * test
      * server tests
    * index.js
    * docker-compose.yaml
    * package.json
    * package-lock.json
    * .gitignore
    
  * TeamMeetingLogs
    * logs of weekly meetings
    
  * package-lock.json
  * ReadMe.md
