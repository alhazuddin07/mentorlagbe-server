import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
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
const user = db.collection("user");
const appplicationCollection = db.collection("appplications")


// users releted api
app.get('/users', async (req, res) => {
    const allUsers = await user.find().toArray();

    const result = allUsers.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        email: item.email,
        role: item.role,
        status: item.status || "active",
        createdAt: item.createdAt,
    }));

    res.send(result);
})

app.patch('/users/:id/status', async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    const result = await user.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: { status }
        }
    )

    res.send(result)
})

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

app.get('/appplications', async(req, res)=> {
    const result = await appplicationCollection.find().toArray();
    res.send(result)
})

app.patch("/tuitions/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { approvalStatus } = req.body;

        // Validate MongoDB ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID",
            });
        }

        // Validate status
        if (!["approved", "rejected"].includes(approvalStatus)) {
            return res.status(400).send({
                success: false,
                message: "Invalid approval status",
            });
        }

        const result = await tutions.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    approvalStatus,
                    updatedAt: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found",
            });
        }

        res.status(200).send({
            success: true,
            message: `Tuition ${approvalStatus} successfully`,
        });

    } catch (error) {
        console.error("Tuition status update error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to update tuition status",
        });
    }
});

// apply for tuition
app.post('/apply-tuitions', async(req, res)=> {
    const user = req.body;
    const result = await appplicationCollection.insertOne(user);
    res.send(result);
})

app.get('/all-tuitions', async (req, res) => {
    const result = await tutions.find().toArray();
    res.send(result);
});

app.get("/tuitions/:id", async (req, res) => {
    try {
        const id = req.params.id;

        const result = await tutions.findOne({
            _id: new ObjectId(id)
        });

        if (!result) {
            return res.status(404).send({
                message: "Tuition not found"
            });
        }

        res.send(result);

    } catch (error) {
        res.status(500).send({
            message: "Something went wrong"
        });
    }
});

// tutions get (supports ?status=... and ?tutorEmail=...)
app.get('/tutions', async (req, res) => {
    try {
        const query = {};
        if (req.query.status) {
            query.approvalStatus = req.query.status;
        }
        if (req.query.tutorEmail) {
            query.tutorEmail = req.query.tutorEmail;
        }
        const result = await tutions.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
    } catch (err) {
        console.error("Error fetching tuitions:", err);
        res.status(500).send({ message: "Failed to fetch tuitions" });
    }
})

app.get("/browse-tuitions", async (req, res) => {
    try {
        const result = await tutions
            .find({
                approvalStatus: "approved",
                isActive: true,
            })
            .toArray();

        res.status(200).send({
            success: true,
            message: "Tuitions fetched successfully",
            data: result,
        });

    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to fetch tuitions",
        });
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`)
})