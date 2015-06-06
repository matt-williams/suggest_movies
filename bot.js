/**
 * Created by Alicia on 06/06/2015.
 */

var Twitter = require('twitter');
var FindAnyFilm = require('findanyfilm');
var http = require('http');
var htmlparser = require("htmlparser2");
var NodeCache = require('node-cache');
var NodeGeocoder = require('node-geocoder');

var HANDLE = '@suggest_movies';

var client = new Twitter(require('./twitter.private.json'));
var findanyfilm = new FindAnyFilm(require('./findanyfilm.private.json'));
var cache = new NodeCache();
var geocoder = NodeGeocoder('openstreetmap', 'http');

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
  cache.get(film.faf_id, function(error, mediaId) {
    if (!error && mediaId) {
      console.log("Got media id " + mediaId + " from cache");
      imageCallback(mediaId);
    } else {
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
              console.log('Posting media');
              client.post('media/upload', {media_data: data.toString('base64')}, function(error, media, response) {
                if (error) throw error;
                var mediaId = media.media_id_string;
                cache.set(film.faf_id, mediaId, function(error) {
                  if (error) {
                    console.log("Failed to set " + film.faf_id + " = " + mediaId + ": " + error);
                  }
                });
                imageCallback(mediaId);
              });
            });
    
          }).on('error', function(error) {
            noImageCallback();
          });
        });
      });
    }
  });
}


function getImageAndTweet(film, message, inReplyTo) {
  getFilmImage(film, function(mediaId) {
    doTweet(message, mediaId, inReplyTo);
  }, function() {
    doTweet(message, null, inReplyTo);
  });
}


function doTweet(message, mediaId, inReplyTo) {
  console.log('Replying with "' + message + '"');
  var tweet = {status: message, in_reply_to_status_id: inReplyTo.id_str};
  if (mediaId) {
    tweet.media_ids = mediaId;
  }
  client.post('statuses/update', tweet,  function(error, tweet, response) {
    if (error) throw error;
  });
}


/**
 * Start stream waiting for tweets
 */
client.stream('statuses/filter', {track: HANDLE}, function(stream) {
    stream.on('data', function(tweet) {
        console.log(tweet.user.screen_name + ' tweeted "' + tweet.text + '"');
        //console.log(getStatusText(tweet.user.id_str));

        var location = "London";
        var filter = {genres: "Thriller"};

        recommendFilm(filter, function(film) {
          var message = "@" + tweet.user.screen_name + " What about " + film.title + "? " + film.url;
          if (location) {
            geocoder.geocode(location).then(function(results) {
              if (results && results.length > 0) {
                var result = results[0];
                console.log('Geolocation = ' + result);
                console.log('User location "' + location + '" => (' + result.latitude + ', ' + result.longitude + ')');
                findanyfilm.getCinemas({faf_id: film.faf_id, latitude: result.latitude, longitude: result.longitude, maxresults: 1}, function(cinemas) {
                  if (cinemas.length > 0) {
                    var cinema = cinemas[0];
                    if (cinema.cinema_showtimes && cinema.cinema_showtimes.length > 0) {
                      var showtimes = cinema.cinema_showtimes[0];
                      var time = new Date(showtimes.time_from);
                      message = "@" + tweet.user.screen_name + " What about " + film.title + " at " + time.getHours() + ":" + ("0" + time.getMinutes()).substr(-2, 2) + "? ";
                      if (showtimes.ticket_link) {
                        message += showtimes.ticket_link;
                      } else if (cinema.link) {
                        message += cinema.link;
                      } else {
                        message += film.url;
                      }
                    }
                  }
                  getImageAndTweet(film, message, tweet);
                });
              } else {
                getImageAndTweet(film, message, tweet);
              }
            }).catch(function(error) {
              getImageAndTweet(film, message, tweet);
            });
          } else {
            getImageAndTweet(film, message, tweet);
          }
        });
    });
    stream.on('error', function(error) {
        throw error;
    });
});

