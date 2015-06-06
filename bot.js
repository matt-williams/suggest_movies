/**
 * Created by Alicia on 06/06/2015.
 */

var Twitter = require('twitter');
var FindAnyFilm = require('findanyfilm');
var http = require('http');
var htmlparser = require("htmlparser2");

var HANDLE = '@suggest_movies';

var client = new Twitter(require('./twitter.private.json'));
var findanyfilm = new FindAnyFilm(require('./findanyfilm.private.json'));

var postingClient = client;
var statusClient = client;


/**
 * Returns a body of recent tweets for a given user id
 */
    function getStatusText(userId) {
    var body = "";
    statusClient.get('statuses/user_timeline/' + userId, function (error, tweets, response) {
        if (error) throw error;
        for (var i = 0; i < tweets.length; i++) {
            var tweetObj = tweets[i];
            body += tweetObj.text + " ";
        }
        body = cleanFeed(body);
        console.log(body);
    });
    return body;
}

/**
 * Method to remove URL's, Twitter Handles, references and other auditory information
 * @param text
 * @returns {string}
 */
function cleanFeed(text) {
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '';
    })
}


/**
 * Filter a list of films based on a filter object.  All criteria in
 * the filter object must match for the film to pass.
 */
function filterFilms(films, filter) {
  var filteredFilms = [];
  for (ii in films) {
    var film = films[ii];
    console.log(film);
    var matched = true;
    for (filterKey in filter) {
      var filterValue = filter[filterKey];
      var filmValue = film[filterKey];
      var matchedFilter = false;
      if (filmValue === filterValue) {
        matchedFilter = true;
      } else if (filmValue instanceof Array) {
        for (jj in filmValue) {
          var value = filmValue[jj];
          if (value === filterValue) {
            matchedFilter = true;
          }
        }
      }
      matched = (matched && matchedFilter);
    }
    if (matched) {
      filteredFilms.push(film);
    }
  }
  return filteredFilms;
}


function recommendFilm(filter, callback) {
  findanyfilm.getFilmsOutNow({format: 8}, function(films) {
    var filteredFilms = filterFilms(films, filter);
    var filmToWatch;
    if (filteredFilms.length > 0) {
      var ii = Math.floor(Math.random() * filteredFilms.length);
      var filmToWatch = filteredFilms[ii];
    } else {
      console.log("No matches - just pick randomly from all films");
      var ii = Math.floor(Math.random() * films.length);
      filmToWatch = films[ii];
    }
    console.log("Suggesting " + filmToWatch);
    callback(filmToWatch);
  });
}

function getFilmImage(film, imageCallback, noImageCallback) {
  console.log('Retrieving HTML at ' + film.url);
  http.get(film.url, function(response) {
    var imageUrl = "";
    var parser = new htmlparser.Parser({
      onopentag: function(name, attribs){
        if (name === "img" && attribs.alt === "trailer_video") {
          imageUrl = "http:" + attribs.src;
        }
      }
    }, {decodeEntities: true});
  
    response.on('data', function (chunk) {
      parser.write(chunk);
    });
  
    response.on('end', function () {
      console.log('Retrieving image at ' + imageUrl);
      http.get(imageUrl, function(response) {
        response.setEncoding('binary');
        var chunks = [];
        
        response.on('data', function (chunk) {
          chunks.push(new Buffer(chunk, 'binary'));
        });
  
        response.on('end', function () {
          var data = Buffer.concat(chunks);
          imageCallback(data);
        });

      }).on('error', function(error) {
        noImageCallback();
      });
    });
  });
}



/**
 * Start stream waiting for tweets
 */
client.stream('statuses/filter', {track: HANDLE}, function(stream) {
    stream.on('data', function(tweet) {
        console.log(tweet.text);
        console.log(getStatusText(tweet.user.id_str));

        recommendFilm({genre: "Adventure"}, function(film) {
          var message = "@" + tweet.user.screen_name + " What about " + film.title + "?";
          getFilmImage(film, function(image) {
            console.log('Posting media');
            client.post('media/upload', {media_data: image.toString('base64')}, function(error, media, response) {
              if (error) throw error;
              console.log('Posting ' + message);
              client.post('statuses/update', {status: message, in_reply_to_status_id: tweet.id_str, media_ids: media.media_id_string},  function(error, tweet, response) {
                if(error) throw error;
                console.log(tweet);  // Tweet body. 
                console.log(response);  // Raw response object. 
              });
            });
          }, function() {
            client.post('statuses/update', {status: message, in_reply_to_status_id: tweet.id_str},  function(error, tweet, response) {
              if(error) throw error;
              console.log(tweet);  // Tweet body. 
              console.log(response);  // Raw response object. 
            });
          });
        });

        //var message = "@"+tweet.user.screen_name+" some reply tweet "+new Date().getTime();
        //postingClient.post('statuses/update', {status: message},  function(error, tweet, response){
        //    if(error) throw error;
        //});
    });
    stream.on('error', function(error) {
        throw error;
    });
});

