const { ApolloServer, UserInputError,AuthenticationError, gql } = require('apollo-server')
const { v1: uuid } = require('uuid')
const mongoose = require('mongoose')

const Author = require('./models/author')
const Book = require('./models/book')
const User = require('./models/user')

const jwt = require('jsonwebtoken')

const { PubSub } = require('apollo-server')
const pubsub = new PubSub()


const JWT_SECRET = 'NEED_HERE_A_SECRET_KEY'

const MONGODB_URI = 'mongodb+srv://fullstac-user:xZLPqXzg4e3zLXjb@myfullstackopencluster.sqiz4.mongodb.net/Library?retryWrites=true'



console.log('connecting to', MONGODB_URI)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message)
  })

const typeDefs = gql`
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!,
    id: ID!
  }

  type Author {
    name: String!
    born: Int
    id: ID!,
    bookCount: Int
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Subscription {
    bookAdded: Book!
  }

  type Query {
    bookCount: Int
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String!]!
    ): Book,
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author,
    createUser(
      username: String!
      favoriteGenre: String!
    ): User,
    login(
      username: String!
      password: String!
    ): Token
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.find({}).then(result => result.length),
    authorCount: () => Author.find({}).then(result => result.length),
    allBooks: async (root, args) => {

      let foundBooks = await Book.find({}).populate('author')

      /* if (args.author) {
        const author  = Author.find({ name: args.author }).then( result => {
          console.log({result})
        })
      } else {
        foundBooks = Book.find({}).populate('author.name').then(result => result);
      } */

      if (args.author) {
        foundBooks = foundBooks.filter(b => b.author.name === args.author);
      }

      if (args.genre) {
        foundBooks = foundBooks.filter(b => b.genres.find(g => g === args.genre));
      }

      return foundBooks.map(b => {
        b.author = b.author.name
        return b
      });
    },
    allAuthors: () => Author.find({}).then(result => result),
    me: (root, args, context) => {
      return context.currentUser
    }
  },
  Author: {
      bookCount: (root) => {
        return books.filter(b => b.author === root.name).length
      }
    },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      let author =  await Author.findOne({ name: args.author})

      if (!author) {
        author = new Author({ name: args.author })

        try {
          await author.save()     
        }
        catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      } 
      
      const book = new Book({ ...args })
      book.author = author._id
      try {
        const newBook = await book.save()

        let savedBook = await Book.findById(newBook._id).populate('author')
        savedBook.author = savedBook.author.name
        console.log({savedBook})

        pubsub.publish('BOOK_ADDED', { bookAdded: savedBook })

        return savedBook
      }    
      catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }

      
    },
    editAuthor: async(root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      const found = await Author.findOne({name: args.name})

      if (found) {
        found.born = args.setBornTo 
        try {
          await found.save()
        }
        
        catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }

        return found
      } else {
        throw new UserInputError("User does not exist")
      }
    },

    createUser: (root, args) => {
        const user = new User({ username: args.username, favoriteGenre: args.favoriteGenre })

        return user.save()
          .catch(error => {
            throw new UserInputError(error.message, {
              invalidArgs: args,
            })
          })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if ( !user || args.password !== 'secred' ) {
        throw new UserInputError("wrong credentials")
      }

      const userForToken = {
        username: user.username,
        id: user._id,
      }

      return { value: jwt.sign(userForToken, JWT_SECRET) }
    },
  },

  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET
      )
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})