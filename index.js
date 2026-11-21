import express from 'express';
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
const paymentsCollection = db.collection("payments");
const bookmarksCollection = db.collection("bookmarks");


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

app.get('/users/:id/premium', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await user.findOne(query, { projection: { premium: 1 } });
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

const FREE_TUITION_LIMIT = 2;

app.post('/tutions', async (req, res) => {
    try {
        const { tutorId } = req.body;

        if (!tutorId) {
            return res.status(400).send({
                success: false,
                message: 'Tutor ID is required'
            });
        }

        const tutor = ObjectId.isValid(tutorId)
            ? await user.findOne(
                { _id: new ObjectId(tutorId) },
                { projection: { premium: 1 } }
            )
            : null;

        // Free tutors can post 3 tuitions. Pro (premium) tutors are unlimited.
        if (!tutor?.premium) {
            const postedCount = await tutions.countDocuments({ tutorId });

            if (postedCount >= FREE_TUITION_LIMIT) {
                return res.status(403).send({
                    success: false,
                    requiresPayment: true,
                    message: `Free tutors can post ${FREE_TUITION_LIMIT} tuitions. Upgrade to Pro to post more.`
                });
            }
        }

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
    } catch (error) {
        console.error('Tuition create error:', error);
        res.status(500).send({
            success: false,
            message: 'Failed to create tuition'
        });
    }
})

app.get('/tuitions/count/:tutorId', async (req, res) => {
    try {
        const count = await tutions.countDocuments({
            tutorId: req.params.tutorId
        });

        res.send({ count });
    } catch (error) {
        console.error('Tuition count error:', error);
        res.status(500).send({ message: 'Failed to get tuition count' });
    }
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

// applica releted api
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

app.get('/applications/student/:email', async (req, res) => {
    try {
        const email = req.params.email;
        if (!email) {
            return res.status(400).send({ message: "Email parameter is required" });
        }
        const result = await appplicationCollection
            .find({ studentEmail: { $regex: new RegExp(`^${email}$`, "i") } })
            .sort({ appliedDate: -1 })
            .toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching student applications:", error);
        res.status(500).send({ message: "Failed to fetch student applications" });
    }
});

app.get('/appplications', async (req, res) => {
    try {
        const query = {};
        const email = req.query.email || req.query.studentEmail;
        if (email) {
            query.studentEmail = { $regex: new RegExp(`^${email}$`, "i") };
        }
        const result = await appplicationCollection.find(query).sort({ appliedDate: -1 }).toArray();
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: "Failed to fetch applications" });
    }
});

// Bookmarks related APIs
app.get('/bookmarks/:userIdentifier', async (req, res) => {
    try {
        const { userIdentifier } = req.params;
        const query = {
            $or: [
                { userId: userIdentifier },
                { userEmail: userIdentifier.toLowerCase() },
            ],
        };
        const result = await bookmarksCollection.find(query).toArray();
        res.send(result);
    } catch (err) {
        console.error("Error fetching bookmarks:", err);
        res.status(500).send({ message: "Failed to fetch bookmarks" });
    }
});

app.post('/bookmarks', async (req, res) => {
    try {
        const { userId, userEmail, tuitionId } = req.body;
        if (!tuitionId) {
            return res.status(400).send({ message: "tuitionId is required" });
        }

        const identifier = userId || userEmail;
        if (!identifier) {
            return res.status(400).send({ message: "User identification required" });
        }

        // Check user plan from user collection
        const userDoc = userId && ObjectId.isValid(userId)
            ? await user.findOne({ _id: new ObjectId(userId) })
            : userEmail
            ? await user.findOne({ email: userEmail.toLowerCase() })
            : null;

        const isPro = userDoc?.plan === "pro" || userDoc?.premium === true;

        if (!isPro) {
            const count = await bookmarksCollection.countDocuments({
                $or: [
                    { userId: identifier },
                    { userEmail: (userEmail || identifier).toLowerCase() },
                ],
            });

            if (count >= 5) {
                return res.status(403).send({
                    requiresPayment: true,
                    message: "Free plan allows up to 5 bookmarks. Upgrade to Pro for unlimited bookmarks.",
                });
            }
        }

        const existing = await bookmarksCollection.findOne({
            $or: [
                { userId: identifier, tuitionId },
                { userEmail: (userEmail || identifier).toLowerCase(), tuitionId },
            ],
        });

        if (existing) {
            return res.send({ success: true, message: "Already bookmarked", bookmark: existing });
        }

        const newBookmark = {
            userId: userId || null,
            userEmail: userEmail ? userEmail.toLowerCase() : null,
            tuitionId,
            createdAt: new Date(),
        };

        const result = await bookmarksCollection.insertOne(newBookmark);
        res.send({ success: true, bookmarkId: result.insertedId });
    } catch (err) {
        console.error("Error creating bookmark:", err);
        res.status(500).send({ message: "Failed to save bookmark" });
    }
});

app.delete('/bookmarks/:userIdentifier/:tuitionId', async (req, res) => {
    try {
        const { userIdentifier, tuitionId } = req.params;
        const query = {
            tuitionId,
            $or: [
                { userId: userIdentifier },
                { userEmail: userIdentifier.toLowerCase() },
            ],
        };
        await bookmarksCollection.deleteOne(query);
        res.send({ success: true, message: "Bookmark removed" });
    } catch (err) {
        console.error("Error deleting bookmark:", err);
        res.status(500).send({ message: "Failed to delete bookmark" });
    }
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

        if (!sessionId) {
            return res.status(400).send({
                success: false,
                message: 'Session ID is required'
            });
        }

        // Retrieve Stripe session
        const session = await stripe.checkout.sessions.retrieve(
            sessionId,
            { expand: ['payment_intent'] }
        );

        const {
            status,
            payment_status,
            customer_email,
            customer_details,
            metadata,
            payment_intent,
            amount_total,
            currency
        } = session;

        // Verify payment
        if (status !== 'complete' || payment_status !== 'paid') {
            return res.status(400).send({
                success: false,
                message: 'Payment verification failed'
            });
        }

        // Check user information
        if (!metadata?.userId) {
            return res.status(400).send({
                success: false,
                message: 'User ID missing from payment metadata'
            });
        }

        const userDoc = ObjectId.isValid(metadata.userId)
            ? await user.findOne({ _id: new ObjectId(metadata.userId) })
            : null;

        const userName = metadata.userName || userDoc?.name;
        const userRole = metadata.userRole || userDoc?.role;
        const planName = metadata.planName || 'MentorLagbe Pro Plan';

        // Check duplicate payment
        const existingPayment = await paymentsCollection.findOne({
            stripeSessionId: session.id
        });

        if (existingPayment) {
            // Backfill details that older payment records are missing.
            const updates = {};

            if (!existingPayment.userName) updates.userName = userName;
            if (!existingPayment.userRole) updates.userRole = userRole;
            if (!existingPayment.planName) updates.planName = planName;

            if (Object.keys(updates).length > 0) {
                await paymentsCollection.updateOne(
                    { _id: existingPayment._id },
                    { $set: updates }
                );

                Object.assign(existingPayment, updates);
            }

            return res.send({
                success: true,
                alreadyVerified: true,
                message: 'Payment already verified',
                payment: existingPayment
            });
        }

        // Prepare payment data
        const payment = {
            userId: metadata.userId,
            userEmail: customer_details?.email || customer_email,
            userName,
            userRole,
            planName,

            amount: amount_total,
            currency: currency,

            transactionId:
                typeof payment_intent === 'string'
                    ? payment_intent
                    : payment_intent?.id,

            stripeSessionId: session.id,
            paymentStatus: "pro",
            paidAt: new Date()
        };

        // Save payment
        await paymentsCollection.insertOne(payment);

        // Update premium status
        await user.updateOne(
            {
                _id: new ObjectId(metadata.userId)
            },
            {
                $set: {
                    premium: true,
                    plan: "pro",
                }
            }
        );

        // Send response
        return res.send({
            success: true,
            alreadyVerified: false,
            message: 'Payment verified successfully',
            payment
        });

    } catch (error) {
        console.error('Payment verification error:', error);

        return res.status(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.get('/payments', async (req, res) => {
    try {
        const result = await paymentsCollection.find().sort({ paidAt: -1 }).toArray();
        res.send(result);
    } catch (err) {
        console.error("Error fetching payments:", err);
        res.status(500).send({ message: "Failed to fetch payments" });
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`)
})