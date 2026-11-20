import express, { application } from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const appplicationCollection = db.collection("appplications");
const paymentsCollection = db.collection("payments")


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

app.get('/users/:id/premium', async(req, res) =>{
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await user.findOne(query, { projection: { premium: 1}});
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

// tutions releted api
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

app.get("/tutions/:id/applications/count", async (req, res) => {
    try {
        const tuitionId = req.params.id;

        const count = await appplicationCollection.countDocuments({
            tuitionId: tuitionId
        });

        res.send({ count });

    } catch (error) {
        res.status(500).send({
            message: "Failed to get application count"
        });
    }
});

app.get("/applications/count/:email", async (req, res) => {
    try {
        const email = req.params.email;

        const count = await appplicationCollection.countDocuments({
            studentEmail: email
        });

        res.send({ count });

    } catch (error) {
        res.status(500).send({
            message: "Failed to get application count"
        });
    }
});

app.get('/appplications/count', async (req, res) => {
    const query = {};
    if (req.query.applicantId) {
        query.userId = req.query.applicantId;
    }
    const result = await appplicationCollection.countDocuments(query);
    res.send({ count: result });
})


// application releted api
app.get('/appplications', async (req, res) => {
    const result = await appplicationCollection.find().toArray();
    res.send(result)
});

app.patch("/applications/:id/status", async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body;

        const allowedStatus = ["Accepted", "Declined"];

        if (!allowedStatus.includes(status)) {
            return res.status(400).send({
                message: "Invalid application status"
            });
        }

        const result = await appplicationCollection.updateOne(
            {
                _id: new ObjectId(id),
                status: "Awaiting Decision"
            },
            {
                $set: { status }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: "Application not found or already reviewed"
            });
        }

        res.send({
            message: "Application status updated successfully",
            result
        });

    } catch (error) {
        res.status(500).send({
            message: "Something went wrong"
        });
    }
});

// tuition releted api
app.post('/apply-tuitions', async (req, res) => {
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

// payments releted api

app.post('/payments/checkout-verify', async (req, res) => {
    try {
        const { sessionId } = req.body;

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const {
            status,
            payment_status,
            customer_email,
            metadata,
            payment_intent
        } = session;

        // Verify payment
        if (status !== "complete" || payment_status !== "paid") {
            return res.send({
                success: false,
                message: "Payment verification failed"
            });
        }

        // Check user ID
        if (!metadata?.userId) {
            return res.status(400).send({
                success: false,
                message: "User ID missing from payment metadata"
            });
        }

        // Prevent duplicate payment records
        const existingPayment = await paymentsCollection.findOne({ sessionId });

        if (existingPayment) {
            return res.send({
                success: false,
                message: "Payment already verified"
            });
        }

        const payment = {
            sessionId,
            status,
            payment_status,
            customer_email,
            userId: metadata.userId,
            payment_date: new Date(),
            payment_intent
        };

        const result = await paymentsCollection.insertOne(payment);

        const query = {
            _id: new ObjectId(metadata.userId)
        };

        const updateDoc = {
            $set: {
                premium: true
            }
        };

        const updateResult = await user.updateOne(
            query,
            updateDoc
        );

        res.send({
            success: true,
            result,
            updateResult
        });

    } catch (error) {
        console.error("Payment verification error:", error);

        res.status(500).send({
            success: false,
            message: "Internal server error"
        });
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`)
})