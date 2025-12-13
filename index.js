require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIP_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN_URL],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URL, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("etuitions-DB");
    const tuitionCollection = db.collection("tuitions");
    const tutorsCollection = db.collection("tutors");
    const usersCollection = db.collection("users");
     const ordersCollection = db.collection("orders");

    // User API
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user already exits" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Student API
    app.post("/tuitions", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await tuitionCollection.insertOne(data);
      res.send(result);
    });

    app.get("/tuitions", async (req, res) => {
      const result = await tuitionCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(4)
        .toArray();
      res.send(result);
    });

    app.get("/available-tuitions", async (req, res) => {
      const result = await tuitionCollection.find().toArray();
      res.send(result);
    });

    app.get("/tuitions/:id", async (req, res) => {
      const id = req.params.id;
      const result = await tuitionCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.put("/tuitions/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: updatedData.name,
          studentClass: updatedData.studentClass,
          location: updatedData.location,
          subjects: updatedData.subjects,
          salary: updatedData.salary,
          daysPerWeek: updatedData.daysPerWeek,
          description: updatedData.description,
          image: updatedData.image,
        },
      };

      const result = await tuitionCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete("/tuitions/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const result = await tuitionCollection.deleteOne(filter);
      res.send(result);
    });

    // Tutor API
    app.post("/tutors", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await tutorsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/tutors", async (req, res) => {
      const result = await tutorsCollection
        .find()
        .sort({ createAt: -1 })
        .limit(3)
        .toArray();
      res.send(result);
    });

    app.get("/available-tutors", async (req, res) => {
      const result = await tutorsCollection.find().toArray();
      res.send(result);
    });

    app.get("/tutors/:id", async (req, res) => {
      const id = req.params.id;
      const result = await tutorsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // User API
    app.post("/users", async (req, res) => {
      const data = req.body;
      const result = await usersCollection.insertOne(data);
      res.send(result);
    });

    //Payment APIs
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo?.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.student?.email,
        mode: "payment",
        metadata: {
          tutorId: paymentInfo?.tutorId,
          student: paymentInfo?.student.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN_URL}/payment-cancel${paymentInfo?.tutorId}`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const tutor = await tutorsCollection.findOne({
        _id: new ObjectId(session.metadata.tutorId),
      });

      const order = await ordersCollection.findOne({
        transactionId: session.payment_intent,
      });
      if (session.status === "complete" && tutor && !order) {
        //save order data in db
        const orderInfo = {
          tutorId: session.metadata.tutorId,
          transactionId: session.payment_intent,
          sudent: session.metadata.student,
          status: "pending",
          // seller: plant.seller,
          // name: plant.name,
          // category: plant.category,
          quantity: 1,
          price: session.amount_total / 100,
          image: tutor.photo,
        };
        const result = await ordersCollection.insertOne(orderInfo);
        // update plant quantity
        // await tuitionCollection.updateOne(
        //   {
        //     _id: new ObjectId(session.metadata.tutorId),
        //   },
        //   { $inc: { quantity: -1 } }
        // );
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
