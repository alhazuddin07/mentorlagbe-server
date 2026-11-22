import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express()
const PORT = process.env.PORT || 5000;

app.use(cors());

// Stripe Webhook endpoint with raw body parsing (MUST be before express.json())
app.post(
    '/payments/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;

        try {
            if (webhookSecret && sig) {
                event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            } else if (!webhookSecret) {
                console.warn('[Stripe Webhook Server] STRIPE_WEBHOOK_SECRET not set. Processing event payload directly in test mode.');
                event = JSON.parse(req.body.toString());
            } else {
                return res.status(400).send({ error: 'Missing stripe-signature header or webhook secret' });
            }
        } catch (err) {
            console.error('[Stripe Webhook Server] Signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    if (session.mode === 'subscription') {
                        const metadata = session.metadata || {};
                        const userId = metadata.userId;
                        const email = (session.customer_details?.email || metadata.userEmail || session.customer_email || '').toLowerCase();
                        const userRole = (metadata.userRole || metadata.role || 'student').toLowerCase();
                        const userName = metadata.userName || session.customer_details?.name || '';
                        const planName = metadata.planName || (userRole === 'tutor' ? 'MentorLagbe Tutor Pro Plan' : 'MentorLagbe Student Pro Plan');
                        const amount = session.amount_total ? session.amount_total / 100 : (userRole === 'tutor' ? 15 : 10);

                        const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
                        const stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
                        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

                        // Idempotency check: prevent duplicate payment records
                        const existing = await paymentsCollection.findOne({
                            $or: [
                                { stripeSessionId: session.id },
                                { eventId: event.id }
                            ]
                        });

                        if (!existing) {
                            await paymentsCollection.insertOne({
                                userId: userId || '',
                                email,
                                role: userRole,
                                plan: 'pro',
                                amount,
                                currency: session.currency || 'usd',
                                status: 'paid',
                                stripeSessionId: session.id,
                                stripeCustomerId: stripeCustomerId || null,
                                stripeSubscriptionId: stripeSubscriptionId || null,
                                paymentIntentId,
                                eventId: event.id,
                                userName,
                                planName,
                                paymentStatus: 'pro',
                                paidAt: new Date(),
                                createdAt: new Date()
                            });
                        }

                        // Update user plan in DB
                        const filter = userId && ObjectId.isValid(userId)
                            ? { $or: [{ _id: new ObjectId(userId) }, { email }] }
                            : { email };

                        await user.updateOne(filter, {
                            $set: {
                                plan: 'pro',
                                premium: true,
                                stripeCustomerId: stripeCustomerId || undefined,
                                stripeSubscriptionId: stripeSubscriptionId || undefined,
                                subscriptionStatus: 'active',
                                updatedAt: new Date()
                            }
                        });
                    }
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;
                    const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
                    const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

                    if (invoice.billing_reason === 'subscription_cycle' && stripeSubscriptionId) {
                        const existing = await paymentsCollection.findOne({
                            $or: [
                                { invoiceId: invoice.id },
                                { eventId: event.id }
                            ]
                        });

                        if (!existing) {
                            const userDoc = await user.findOne({
                                $or: [
                                    { stripeSubscriptionId },
                                    { stripeCustomerId }
                                ]
                            });

                            const userRole = userDoc?.role || 'student';
                            const amount = invoice.amount_paid ? invoice.amount_paid / 100 : (userRole === 'tutor' ? 15 : 10);

                            await paymentsCollection.insertOne({
                                userId: userDoc?._id?.toString() || '',
                                email: (invoice.customer_email || userDoc?.email || '').toLowerCase(),
                                role: userRole,
                                plan: 'pro',
                                amount,
                                currency: invoice.currency || 'usd',
                                status: 'paid',
                                stripeSessionId: null,
                                stripeCustomerId: stripeCustomerId || null,
                                stripeSubscriptionId,
                                paymentIntentId: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id || null,
                                invoiceId: invoice.id,
                                eventId: event.id,
                                userName: userDoc?.name || '',
                                planName: userRole === 'tutor' ? 'MentorLagbe Tutor Pro Plan' : 'MentorLagbe Student Pro Plan',
                                paymentStatus: 'pro',
                                paidAt: new Date(),
                                createdAt: new Date()
                            });
                        }

                        await user.updateOne(
                            {
                                $or: [
                                    { stripeSubscriptionId },
                                    { stripeCustomerId }
                                ]
                            },
                            {
                                $set: {
                                    plan: 'pro',
                                    premium: true,
                                    subscriptionStatus: 'active',
                                    updatedAt: new Date()
                                }
                            }
                        );
                    }
                    break;
                }

                case 'invoice.payment_failed': {
                    const invoice = event.data.object;
                    const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
                    const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

                    if (stripeSubscriptionId || stripeCustomerId) {
                        await user.updateOne(
                            {
                                $or: [
                                    { stripeSubscriptionId },
                                    { stripeCustomerId }
                                ]
                            },
                            {
                                $set: {
                                    subscriptionStatus: 'past_due',
                                    updatedAt: new Date()
                                }
                            }
                        );
                    }
                    break;
                }

                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    const stripeSubscriptionId = subscription.id;
                    const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

                    await user.updateOne(
                        {
                            $or: [
                                { stripeSubscriptionId },
                                { stripeCustomerId }
                            ]
                        },
                        {
                            $set: {
                                plan: 'free',
                                premium: false,
                                subscriptionStatus: 'canceled',
                                updatedAt: new Date()
                            }
                        }
                    );
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object;
                    const stripeSubscriptionId = subscription.id;
                    const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
                    const status = subscription.status;

                    if (status === 'active') {
                        await user.updateOne(
                            {
                                $or: [
                                    { stripeSubscriptionId },
                                    { stripeCustomerId }
                                ]
                            },
                            {
                                $set: {
                                    plan: 'pro',
                                    premium: true,
                                    subscriptionStatus: 'active',
                                    updatedAt: new Date()
                                }
                            }
                        );
                    } else if (status === 'canceled' || status === 'unpaid') {
                        await user.updateOne(
                            {
                                $or: [
                                    { stripeSubscriptionId },
                                    { stripeCustomerId }
                                ]
                            },
                            {
                                $set: {
                                    plan: 'free',
                                    premium: false,
                                    subscriptionStatus: status,
                                    updatedAt: new Date()
                                }
                            }
                        );
                    }
                    break;
                }

                default:
                    break;
            }

            res.send({ received: true });
        } catch (err) {
            console.error('[Stripe Webhook Server] Error processing event:', err);
            res.status(500).send({ error: 'Webhook processing failed' });
        }
    }
);

app.use(express.json());

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
const applicationsCollection = db.collection("applications");
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
        const { tutorId, tutorEmail } = req.body;

        if (!tutorId && !tutorEmail) {
            return res.status(400).send({
                success: false,
                message: 'Tutor ID or email is required'
            });
        }

        const tutor = tutorId && ObjectId.isValid(tutorId)
            ? await user.findOne({ _id: new ObjectId(tutorId) })
            : tutorEmail
            ? await user.findOne({ email: tutorEmail.toLowerCase() })
            : null;

        // Role-based authorization: Only registered tutors (or admin) can post tuitions
        if (tutor && tutor.role && tutor.role !== "tutor" && tutor.role !== "admin") {
            return res.status(403).send({
                success: false,
                message: "Only tutors can create tuition listings."
            });
        }

        // Plan check: Pro tutors can post unlimited. Free tutors are limited to 2 tuitions.
        const isPro = tutor?.plan === "pro" || tutor?.premium === true;

        if (!isPro) {
            const countQuery = {
                $or: [
                    ...(tutorId ? [{ tutorId }] : []),
                    ...(tutorEmail ? [{ tutorEmail: tutorEmail.toLowerCase() }] : []),
                    ...(tutor?.email ? [{ tutorEmail: tutor.email.toLowerCase() }] : [])
                ]
            };
            const postedCount = await tutions.countDocuments(countQuery);

            if (postedCount >= FREE_TUITION_LIMIT) {
                return res.status(403).send({
                    success: false,
                    requiresPayment: true,
                    message: `Free tutors can post a maximum of ${FREE_TUITION_LIMIT} tuitions. Upgrade to Pro for unlimited tuitions.`
                });
            }
        }

        const newTuition = {
            ...req.body,
            tutorId: tutorId || tutor?._id?.toString(),
            tutorName: req.body.tutorName || tutor?.name || "Tutor",
            tutorEmail: (req.body.tutorEmail || tutor?.email || "").toLowerCase(),
            approvalStatus: "pending",
            isActive: true,
            createdAt: new Date(),
        };

        const result = await tutions.insertOne(newTuition);

        res.send({
            success: true,
            message: "Tuition posted successfully and submitted for admin review.",
            insertedId: result.insertedId
        });
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

        const count = await applicationsCollection.countDocuments({
            tuitionId: tuitionId
        });

        res.send({ count });

    } catch (error) {
        res.status(500).send({
            message: "Failed to get application count"
        });
    }
});

app.get('/applications/student/:email', async (req, res) => {
    try {
        const email = req.params.email;
        if (!email) {
            return res.status(400).send({ message: "Email parameter is required" });
        }
        const result = await applicationsCollection
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
        const result = await applicationsCollection.find(query).sort({ appliedDate: -1 }).toArray();
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

        const query = {
            _id: new ObjectId(id),
            status: { $in: ["pending", "Awaiting Decision"] }
        };

        const result = await applicationsCollection.updateOne(
            query,
            {
                $set: { status, updatedAt: new Date() }
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

// tuition application api
app.post('/apply-tuitions', async (req, res) => {
    try {
        const { tuitionId, studentEmail, tutorEmail } = req.body;

        if (!tuitionId) {
            return res.status(400).send({
                success: false,
                message: "Tuition ID is required"
            });
        }

        if (!studentEmail) {
            return res.status(400).send({
                success: false,
                message: "Student email is required"
            });
        }

        // Prevent duplicate applications from the same student for the same tuition
        const existingApp = await applicationsCollection.findOne({
            tuitionId: tuitionId,
            studentEmail: { $regex: new RegExp(`^${studentEmail.trim()}$`, "i") }
        });

        if (existingApp) {
            return res.status(400).send({
                success: false,
                duplicate: true,
                message: "You have already applied for this tuition."
            });
        }

        // Retrieve tuition details to ensure tutorEmail is stored and prevent self-application
        let resolvedTutorEmail = tutorEmail;
        if (ObjectId.isValid(tuitionId)) {
            const tuitionDoc = await tutions.findOne({ _id: new ObjectId(tuitionId) });
            if (!resolvedTutorEmail) {
                resolvedTutorEmail = tuitionDoc?.tutorEmail || null;
            }
        }

        if (resolvedTutorEmail && resolvedTutorEmail.toLowerCase() === studentEmail.trim().toLowerCase()) {
            return res.status(400).send({
                success: false,
                message: "You cannot apply for your own tuition listing."
            });
        }

        const application = {
            ...req.body,
            tuitionId,
            tutorEmail: resolvedTutorEmail,
            studentEmail: studentEmail.trim().toLowerCase(),
            status: "pending",
            appliedDate: req.body.appliedDate ? new Date(req.body.appliedDate) : new Date(),
        };

        const result = await applicationsCollection.insertOne(application);

        res.send({
            success: true,
            message: "Application submitted successfully",
            insertedId: result.insertedId
        });

    } catch (err) {
        console.error("Application create error:", err);
        res.status(500).send({
            success: false,
            message: "Failed to submit application"
        });
    }
});


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
            { expand: ['payment_intent', 'subscription'] }
        );

        const {
            status,
            payment_status,
            customer_email,
            customer_details,
            metadata,
            payment_intent,
            amount_total,
            currency,
            subscription,
            customer
        } = session;

        // Verify payment status
        if (status !== 'complete' || payment_status !== 'paid') {
            return res.status(400).send({
                success: false,
                message: 'Payment verification failed'
            });
        }

        // Check if webhook already created the payment record
        const existingPayment = await paymentsCollection.findOne({
            stripeSessionId: session.id
        });

        if (existingPayment) {
            return res.send({
                success: true,
                alreadyVerified: true,
                message: 'Payment verified',
                payment: existingPayment
            });
        }

        const userDoc = metadata?.userId && ObjectId.isValid(metadata.userId)
            ? await user.findOne({ _id: new ObjectId(metadata.userId) })
            : null;

        const userName = metadata?.userName || userDoc?.name || customer_details?.name || 'Customer';
        const userRole = metadata?.userRole || metadata?.role || userDoc?.role || 'student';
        const planName = metadata?.planName || (userRole === 'tutor' ? 'MentorLagbe Tutor Pro Plan' : 'MentorLagbe Student Pro Plan');
        const amount = amount_total ? amount_total / 100 : (userRole === 'tutor' ? 15 : 10);

        // Return details for receipt display without mutating user plan directly
        const paymentDisplay = {
            userId: metadata?.userId || userDoc?._id?.toString() || '',
            email: customer_details?.email || customer_email || userDoc?.email,
            userEmail: customer_details?.email || customer_email || userDoc?.email,
            userName,
            userRole,
            role: userRole,
            planName,
            plan: 'pro',
            amount,
            currency: currency || 'usd',
            transactionId: typeof payment_intent === 'string' ? payment_intent : payment_intent?.id || session.id,
            stripeSessionId: session.id,
            stripeCustomerId: typeof customer === 'string' ? customer : customer?.id,
            stripeSubscriptionId: typeof subscription === 'string' ? subscription : subscription?.id,
            paymentStatus: 'pro',
            status: 'paid',
            paidAt: new Date()
        };

        return res.send({
            success: true,
            alreadyVerified: false,
            message: 'Payment verified successfully',
            payment: paymentDisplay
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