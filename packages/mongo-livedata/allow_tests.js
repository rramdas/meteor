(function () {
  // helper for defining a collection, subscribing to it, and defining
  // a method to clear it
  var defineCollection = function(name, insecure) {
    var oldInsecure = Meteor.Collection.insecure;
    Meteor.Collection.insecure = insecure;
    var collection = new Meteor.Collection(name);
    Meteor.Collection.insecure = oldInsecure;

    if (Meteor.is_server) {
      Meteor.publish("collection-" + name, function() {
        return collection.find();
      });

      m = {};
      m["clear-collection-" + name] = function() {
        collection.remove({});
      };
      Meteor.methods(m);
    } else {
      Meteor.subscribe("collection-" + name);
    }

    collection.callClearMethod = function (callback) {
      Meteor.call("clear-collection-" + name, callback);
    };
    return collection;
  };

  // totally insecure collection
  insecureCollection = defineCollection(
    "collection-insecure", true /*insecure*/);

  // totally locked down collection
  lockedDownCollection = defineCollection(
    "collection-locked-down", false /*insecure*/);

  // resticted collection with same allowed modifications, both with and
  // without the `insecure` package
  restrictedCollectionDefaultSecure = defineCollection(
    "collection-restrictedDefaultSecure", false /*insecure*/);
  restrictedCollectionDefaultInsecure = defineCollection(
    "collection-restrictedDefaultInsecure", true /*insecure*/);
  restrictedCollectionForUpdateOptionsTest = defineCollection(
    "collection-restrictedForUpdateOptionsTest", true /*insecure*/);
  restrictedCollectionForPartialAllowTest = defineCollection(
    "collection-restrictedForPartialAllowTest", true /*insecure*/);
  restrictedCollectionForFetchTest = defineCollection(
    "collection-restrictedForFetchTest", true /*insecure*/);
  restrictedCollectionForFetchAllTest = defineCollection(
    "collection-restrictedForFetchAllTest", true /*insecure*/);

  // two calls to allow to verify that all validators need to be
  // satisfied
  var allows = [{
    insert: function(userId, doc) {
      return doc.canModify;
    },
    update: function(userId, docs) {
      return _.all(docs, function (doc) {
        return doc.canModify;
      });
    },
    remove: function (userId, docs) {
      return _.all(docs, function (doc) {
        return doc.canModify;
      });
    }
  }, {
    insert: function(userId, doc) {
      return doc.canInsert;
    },
    update: function(userId, docs, fields, modifier) {
      return (-1 === _.indexOf(fields, 'verySecret')) &&
        _.all(docs, function (doc) {
          return doc.canUpdate;
        });
    },
    remove: function(userId, docs) {
      return _.all(docs, function (doc) {
        return doc.canRemove;
      });
    }
  }];


  if (Meteor.is_server) {
    _.each(allows, function (allow) {
      _.each([
        restrictedCollectionDefaultSecure,
        restrictedCollectionDefaultInsecure,
        restrictedCollectionForUpdateOptionsTest
      ], function (collection) {
        collection.allow(allow);
      });
    });

    // just restrict one operation so that we can verify that others
    // fail
    restrictedCollectionForPartialAllowTest.allow({
      insert: function() {}
    });

    // verify that we only fetch the fields specified - we should
    // be fetching just field1 and field2
    restrictedCollectionForFetchTest.allow({
      insert: function() { return true; },
      update: function(userId, docs) {
        // throw fields in first doc so that we can inspect them in test
        throw new Meteor.Error(
          "Test: Fields in doc: " + _.keys(docs[0]).join(','));
      },
      remove: function(userId, docs) {
        // throw fields in first doc so that we can inspect them in test
        throw new Meteor.Error(
          "Test: Fields in doc: " + _.keys(docs[0]).join(','));
      },
      fetch: ['field1']
    });
    restrictedCollectionForFetchTest.allow({
      fetch: ['field2']
    });

    // verify that not passing fetch to one of the calls to allow
    // causes all fields to be fetched
    restrictedCollectionForFetchAllTest.allow({
      insert: function() { return true; },
      update: function(userId, docs) {
        // throw fields in first doc so that we can inspect them in test
        throw new Meteor.Error(
          "Test: Fields in doc: " + _.keys(docs[0]).join(','));
      },
      remove: function(userId, docs) {
        // throw fields in first doc so that we can inspect them in test
        throw new Meteor.Error(
          "Test: Fields in doc: " + _.keys(docs[0]).join(','));
      },
      fetch: ['field1']
    });
    restrictedCollectionForFetchAllTest.allow({
      insert: function() { return true; }
    });
  }

  if (Meteor.is_server) {
    Tinytest.add("collection - calling allow restricts", function (test) {
      collection = new Meteor.Collection(null);
      test.equal(collection._restricted, undefined);
      collection.allow({
        insert: function() {}
      });
      test.equal(collection._restricted, true);
    });
  }

  if (Meteor.is_client) {
    // test that if allow is called once then the collection is
    // restricted, and that other mutations aren't allowed
    testAsyncMulti("collection - partial allow", [
      function (test, expect) {
        restrictedCollectionForPartialAllowTest.update(
          {}, {$set: {updated: true}}, expect(function (err, res) {
            test.equal(err.error, 'Access denied. No update validators set on restricted collection.');
          }));
      }
    ]);

    // test that we only fetch the fields specified
    testAsyncMulti("collection - fetch", [
      function (test, expect) {
        restrictedCollectionForFetchTest.insert(
          {field1: 1, field2: 1, field3: 1});
        restrictedCollectionForFetchAllTest.insert(
          {field1: 1, field2: 1, field3: 1});

      }, function (test, expect) {
        restrictedCollectionForFetchTest.update(
          {}, {$set: {updated: true}}, expect(function (err, res) {
            test.equal(err.error, "Test: Fields in doc: field1,field2,_id");
          }));
        restrictedCollectionForFetchTest.remove(
          {}, expect(function (err, res) {
            test.equal(err.error, "Test: Fields in doc: field1,field2,_id");
          }));

        restrictedCollectionForFetchAllTest.update(
          {}, {$set: {updated: true}}, expect(function (err, res) {
            test.equal(err.error,
                       "Test: Fields in doc: field1,field2,field3,_id");
          }));
        restrictedCollectionForFetchAllTest.remove(
          {}, expect(function (err, res) {
            test.equal(err.error,
                       "Test: Fields in doc: field1,field2,field3,_id");
          }));

      }
    ]);
  }

  if (Meteor.is_client) {
    testAsyncMulti("collection - insecure", [
      function (test, expect) {
        insecureCollection.callClearMethod(expect(function () {
          test.equal(lockedDownCollection.find().count(), 0);
        }));
      },
      function (test, expect) {
        insecureCollection.insert({foo: 'bar'}, expect(function(err, res) {
          test.equal(insecureCollection.find().count(), 1);
          test.equal(insecureCollection.findOne().foo, 'bar');
        }));
        test.equal(insecureCollection.find().count(), 1);
        test.equal(insecureCollection.findOne().foo, 'bar');
      }
    ]);

    testAsyncMulti("collection - locked down", [
      function (test, expect) {
        lockedDownCollection.callClearMethod(expect(function() {
          test.equal(lockedDownCollection.find().count(), 0);
        }));
      },
      function (test, expect) {
        lockedDownCollection.insert({foo: 'bar'}, expect(function (err, res) {
          test.equal(err.error, "Access denied");
        }));
        Meteor.default_connection.onQuiesce(expect(function () {
          test.equal(lockedDownCollection.find().count(), 0);
        }));
      }
    ]);

    (function () {
      var collection = restrictedCollectionForUpdateOptionsTest;
      testAsyncMulti("collection - update options", [
        // init
        function (test, expect) {
          collection.callClearMethod();
          Meteor.default_connection.onQuiesce(expect(function () {
            test.equal(collection.find().count(), 0);
          }));
        },
        // put a few objects
        function (test, expect) {
          var doc = {canInsert: true, canUpdate: true, canModify: true};
          collection.insert(doc);
          collection.insert(doc);
          collection.insert(doc, expect(function (err, res) {
            test.isFalse(err);
            test.equal(collection.find().count(), 3);
          }));
        },
        // update without the `multi` option
        function (test, expect) {
          collection.update(
            {},
            {$set: {updated: true}},
            expect(function (err, res) {
              test.equal(collection.find({updated: true}).count(), 1);
            }));
        },
        // update with the `multi` option
        function (test, expect) {
          collection.update(
            {},
            {$set: {updated: true}},
            {multi: true},
            expect(function (err, res) {
              test.equal(collection.find({updated: true}).count(), 3);
            }));
        }
      ]);
    }) ();
    
    _.each(
      [restrictedCollectionDefaultInsecure, restrictedCollectionDefaultSecure],
      function(collection) {
        testAsyncMulti("collection - " + collection._name, [
          // init
          function (test, expect) {
            collection.callClearMethod();
            Meteor.default_connection.onQuiesce(expect(function () {
              test.equal(collection.find().count(), 0);
            }));
          },

          // insert checks validator
          function (test, expect) {
            collection.insert({canInsert: false}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              test.equal(collection.find().count(), 0);
            }));
          },
          // insert checks all validators
          function (test, expect) {
            collection.insert({canInsert: true}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              test.equal(collection.find().count(), 0);
            }));
          },
          // an insert that passes validators indeed executes
          function (test, expect) {
            collection.insert(
              {canInsert: true, canModify: true},
              expect(function (err, res) {
                test.isFalse(err);
                test.equal(collection.find().count(), 1);
                test.equal(collection.findOne().canInsert, true);
              }));
          },
          // another insert executes, so that we have two different
          // docs to work with (this one has canUpdate set)
          function (test, expect) {
            collection.insert(
              {canInsert: true, canUpdate: true, canModify: true},
              expect(function (err, res) {
                test.isFalse(err);
                test.equal(collection.find().count(), 2);
                test.equal(collection.find().fetch()[1].canInsert, true);
                test.equal(collection.find().fetch()[1].canUpdate, true);
              }));
          },
          // yet a third insert executes. this one has canRemove set
          function (test, expect) {
            collection.insert(
              {canInsert: true, canRemove: true, canModify: true},
              expect(function (err, res) {
                test.isFalse(err);
                test.equal(collection.find().count(), 3);
                test.equal(collection.find().fetch()[1].canInsert, true);
                test.equal(collection.find().fetch()[1].canUpdate, true);
                test.equal(collection.find().fetch()[2].canInsert, true);
                test.equal(collection.find().fetch()[2].canRemove, true);
              }));
          },

          // can't update to a new object
          function (test, expect) {
            collection.update(
              {canInsert: true},
              {newObject: 1},
              expect(function (err, res) {
                test.equal(
                  err.error,
                  "Access denied. Can't replace document in restricted collection.");
              }));
          },

          // updating dotted fields works as if we are chaninging their top part
          function (test, expect) {
            collection.update(
              {canInsert: true, canUpdate: true},
              {$set: {"dotted.field": 1}},
              expect(function (err, res) {
                test.equal(collection.findOne({canUpdate: true}).dotted.field, 1);
              }));
          },
          function (test, expect) {
            collection.update(
              {canInsert: true, canUpdate: true},
              {$set: {"verySecret.field": 1}},
              expect(function (err, res) {
                test.equal(err.error, "Access denied");
              }));
          },

          // update doesn't do anything if no docs match
          function (test, expect) {
            collection.update({canInsert: false}, {$set: {updated: true}}, expect(function (err, res) {
              test.isFalse(err);
              // nothing has changed
              test.equal(collection.find().count(), 3);
              test.equal(collection.find().fetch()[1].canInsert, true);
              test.equal(collection.find().fetch()[1].canUpdate, true);
              test.equal(collection.find().fetch()[1].updated, undefined);
            }));
          },
          // update fails when access is denied trying to set `verySecret`
          function (test, expect) {
            collection.update({canInsert: true}, {$set: {verySecret: true}}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              // nothing has changed
              test.equal(collection.find().count(), 3);
              test.equal(collection.find().fetch()[1].canInsert, true);
              test.equal(collection.find().fetch()[1].canUpdate, true);
              test.equal(collection.find().fetch()[1].updated, undefined);
            }));
          },
          // update fails when trying to set two fields, one of which is
          // `verySecret`
          function (test, expect) {
            collection.update({canInsert: true}, {$set: {updated: true, verySecret: true}}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              // nothing has changed
              test.equal(collection.find().count(), 3);
              test.equal(collection.find().fetch()[1].canInsert, true);
              test.equal(collection.find().fetch()[1].canUpdate, true);
              test.equal(collection.find().fetch()[1].updated, undefined);
            }));
          },
          // update fails when trying to modify docs that don't
          // have `canUpdate` set
          function (test, expect) {
            collection.update({canInsert: true}, {$set: {updated: true}}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              // nothing has changed
              test.equal(collection.find().count(), 3);
              test.equal(collection.find().fetch()[1].canInsert, true);
              test.equal(collection.find().fetch()[1].canUpdate, true);
              test.equal(collection.find().fetch()[1].updated, undefined);
            }));
          },
          // update executes when it should
          function (test, expect) {
            collection.update({canUpdate: true}, {$set: {updated: true}}, expect(function (err, res) {
              test.isFalse(err);
              test.equal(collection.find().fetch()[1].updated, true);
            }));
          },

          // remove fails when trying to modify an doc with no
          // `canRemove` set
          function (test, expect) {
            collection.remove({canInsert: true}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              // nothing has changed
              test.equal(collection.find().count(), 3);
            }));
          },
          // another test that remove fails with no `canRemove` set
          function (test, expect) {
            collection.remove({canUpdate: true}, expect(function (err, res) {
              test.equal(err.error, "Access denied");
              // nothing has changed
              test.equal(collection.find().count(), 3);
            }));
          },
          // remove executes when it should!
          function (test, expect) {
            collection.remove({canRemove: true}, expect(function (err, res) {
              test.isFalse(err);
              // successfully removed
              test.equal(collection.find().count(), 2);
            }));
          },

          // methods can still bypass restrictions
          function (test, expect) {
            collection.callClearMethod(expect(function (err, res) {
              test.isFalse(err);
              // successfully removed
            }));
            Meteor.default_connection.onQuiesce(expect(function () {
              test.equal(collection.find().count(), 0);
            }));
          }
        ]);
      });
  }
}) ();
