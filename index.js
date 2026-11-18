import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';

const app = express()
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db("mentor-lagbe");
const tutions = db.collection("tutions");

// tutions post
app.post('/tutions', async (req, res) => {
    const newTuition = {
        ...req.body,
        tutorName: req.body.tutorName,
        tutorEmail: req.body.tutorEmail,
        approvalStatus: "pending",
        isActive: true,
        createdAt: new Date(),
    };
    
    const result = await tutions.insertOne(newTuition);
    res.send(result);
})

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`)
})