import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express()
const PORT = process.env.PORT || 5000;

app.use(cors());

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
const sessions = db.collection("session");


const verifyToken = async (req, res, next) => {
    try {
        // Get Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).send({
                success: false,
                message: "Unauthorized: Token missing"
            });
        }

        // Extract token
        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).send({
                success: false,
                message: "Unauthorized: Invalid token"
            });
        }

        // Find session
        const session = await sessions.findOne({ token });

        if (!session) {
            return res.status(401).send({
                success: false,
                message: "Unauthorized: Invalid session"
            });
        }

        // Find user
        const userDoc = await user.findOne({
            _id: new ObjectId(session.userId)
        });

        if (!userDoc) {
            return res.status(401).send({
                success: false,
                message: "Unauthorized: User not found"
            });
        }

        // Attach user to request
        req.user = userDoc;

        next();

    } catch (error) {
        console.error("Verify token error:", error);

        return res.status(500).send({
            success: false,
            message: "Authentication failed"
        });
    }
};



const verifyStudent = async (req, res, next) => {
    if (req.user.role !== "student") {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
};

const verifyTutor = async (req, res, next) => {
    if (req.user.role !== "tutor") {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
};

const verifyAdmin = async (req, res, next) => {
    if (req.user.role !== "admin") {
        res.status(403).send({ message: 'Forbidden' });
        return;
    }
    next();
};


// users releted api
app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
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

app.get('/users/:id/premium', verifyToken, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await user.findOne(query, { projection: { premium: 1 } });
    res.send(result);
})

app.patch('/users/:id/status', verifyToken, verifyAdmin, async (req, res) => {
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

app.patch('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { role } = req.body;

        const allowedRoles = ["admin", "student", "tutor"];

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid user ID"
            });
        }

        if (!allowedRoles.includes(role)) {
            return res.status(400).send({
                success: false,
                message: "Invalid role"
            });
        }

        const result = await user.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    role,
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "User not found"
            });
        }

        res.send({
            success: true,
            message: "User role updated successfully"
        });

    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to update user role"
        });
    }
});

// tutions releted api

const FREE_TUITION_LIMIT = 2;

app.post('/tutions', verifyToken, verifyTutor, async (req, res) => {
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

app.get('/tuitions/count/:tutorId', verifyToken, verifyTutor, async (req, res) => {
    try {
        const { tutorId } = req.params;

        if (req.user._id.toString() !== tutorId) {
            return res.status(403).send({
                success: false,
                message: 'Forbidden access'
            });
        }

        const count = await tutions.countDocuments({
            tutorId: tutorId
        });

        res.send({ count });

    } catch (error) {
        console.error('Tuition count error:', error);

        res.status(500).send({
            message: 'Failed to get tuition count'
        });
    }
});


app.patch("/tuitions/:id/status", verifyToken, verifyAdmin, async (req, res) => {
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

app.patch("/tuitions/:id/toggle-status", verifyToken, verifyTutor, async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID"
            });
        }

        if (typeof isActive !== "boolean") {
            return res.status(400).send({
                success: false,
                message: "Valid status is required"
            });
        }

        // Find tuition
        const tuition = await tutions.findOne({
            _id: new ObjectId(id)
        });

        if (!tuition) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        // Check ownership
        if (
            tuition.tutorId?.toString() !==
            req.user._id.toString()
        ) {
            return res.status(403).send({
                success: false,
                message: "Forbidden"
            });
        }

        // Update status
        const result = await tutions.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    isActive,
                    updatedAt: new Date()
                }
            }
        );

        res.send({
            success: true,
            message: `Tuition ${isActive ? "activated" : "deactivated"} successfully`,
            result
        });

    } catch (error) {
        console.error("Toggle tuition status error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to update tuition status",
            error: error.message
        });
    }
});

app.get("/tutions/:id/applications/count", verifyToken, verifyTutor, async (req, res) => {
    try {
        const tuitionId = req.params.id;

        // Check tuition ownership
        const tuition = await tutions.findOne({
            _id: new ObjectId(tuitionId),
            tutorId: req.user._id.toString(),
        });

        if (!tuition) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found",
            });
        }

        const count = await applicationsCollection.countDocuments({
            tuitionId,
        });

        res.send({ count });

    } catch (error) {
        console.error("Application count error:", error);

        res.status(500).send({
            message: "Failed to get application count",
        });
    }
}
);


app.get('/applications', verifyToken, async (req, res) => {
    try {
        const query = {};

        if (req.user.role === "tutor") {
            const tutorId = req.user._id.toString();

            const myTuitions = await tutions
                .find({ tutorId })
                .project({ _id: 1 })
                .toArray();

            const tuitionIds = myTuitions.map(
                (tuition) => tuition._id.toString()
            );

            if (req.query.tuitionId) {
                const tuitionId = req.query.tuitionId;

                if (!tuitionIds.includes(tuitionId)) {
                    return res.status(403).send({
                        success: false,
                        message: "You cannot access these applications",
                    });
                }

                query.tuitionId = tuitionId;
            } else {
                query.tuitionId = { $in: tuitionIds };
            }

        } else if (req.query.applicantEmail) {
            // Student নিজের applications দেখতে পারবে
            query.studentEmail = req.user.email;
        }

        const result = await applicationsCollection
            .find(query)
            .sort({ appliedDate: -1 })
            .toArray();

        res.send(result);

    } catch (error) {
        console.error("Fetch applications error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to fetch applications",
        });
    }
});

app.delete("/applications/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid application ID",
            });
        }

        const application = await applicationsCollection.findOne({
            _id: new ObjectId(id),
        });

        if (!application) {
            return res.status(404).send({
                success: false,
                message: "Application not found",
            });
        }

        if (
            req.user.role !== "student" ||
            req.user.email.toLowerCase() !== application.studentEmail.toLowerCase()
        ) {
            return res.status(403).send({
                success: false,
                message: "You are not allowed to delete this application",
            });
        }

        const result = await applicationsCollection.deleteOne({
            _id: new ObjectId(id),
            studentEmail: application.studentEmail,
        });

        if (result.deletedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Application could not be deleted",
            });
        }

        res.send({
            success: true,
            message: "Application deleted successfully",
        });

    } catch (error) {
        console.error("Delete application error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to delete application",
        });
    }
});

app.get('/applications/count', verifyToken, async (req, res) => {
    try {
        const query = {};

        if (req.query.applicantId) {
            query.studentEmail = req.user.email;
        }

        const result = await applicationsCollection.countDocuments(query);

        res.send({
            success: true,
            count: result,
        });

    } catch (error) {
        console.error("Application count error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to get application count",
        });
    }
});

// Bookmarks related APIs

app.post("/bookmarks", verifyToken, verifyStudent, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { tuitionId } = req.body;

        // Validate tuitionId
        if (!tuitionId || !ObjectId.isValid(tuitionId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID"
            });
        }

        // Find user
        const currentUser = await user.findOne({
            _id: new ObjectId(userId)
        });

        if (!currentUser) {
            return res.status(404).send({
                success: false,
                message: "User not found"
            });
        }

        // Check if already bookmarked
        const existingBookmark = await bookmarksCollection.findOne({
            userId,
            tuitionId
        });

        if (existingBookmark) {
            return res.status(409).send({
                success: false,
                message: "Already bookmarked"
            });
        }

        // Check subscription plan
        const isPro = currentUser.plan === "pro";

        // Count existing bookmarks
        const bookmarkCount = await bookmarksCollection.countDocuments({
            userId
        });

        // Free student limit: 5 bookmarks
        if (!isPro && bookmarkCount >= 5) {
            return res.status(409).send({
                success: false,
                requiresPayment: true,
                message: "Free students can bookmark only 5 tuitions. Upgrade to Pro for unlimited bookmarks."
            });
        }

        // Create bookmark
        const bookmark = {
            userId,
            userEmail: currentUser.email,
            tuitionId,
            createdAt: new Date()
        };

        const result = await bookmarksCollection.insertOne(bookmark);

        res.status(201).send({
            success: true,
            message: "Bookmark added successfully",
            data: result
        });

    } catch (error) {
        console.error("Add bookmark error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to add bookmark"
        });
    }
});

app.get("/bookmarks/:userId", verifyToken, verifyStudent, async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await bookmarksCollection.aggregate([
            {
                $match: { userId }
            },
            {
                $addFields: {
                    tuitionObjectId: {
                        $toObjectId: "$tuitionId"
                    }
                }
            },
            {
                $lookup: {
                    from: "tutions",
                    localField: "tuitionObjectId",
                    foreignField: "_id",
                    as: "tuition"
                }
            },
            {
                $unwind: "$tuition"
            },
            {
                $project: {
                    tuitionObjectId: 0
                }
            }
        ]).toArray();

        res.send({
            success: true,
            data: result
        });

    } catch (error) {
        res.status(500).send({
            success: false,
            message: "Failed to fetch bookmarks"
        });
    }
});

app.delete("/bookmarks/:tuitionId", verifyToken, verifyStudent, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { tuitionId } = req.params;

        if (!ObjectId.isValid(tuitionId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID",
            });
        }

        const result = await bookmarksCollection.deleteOne({
            userId,
            tuitionId,
        });

        console.log("Delete Result:", result);

        if (result.deletedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Bookmark not found",
            });
        }

        res.send({
            success: true,
            message: "Bookmark removed successfully",
        });
    } catch (error) {
        console.error("Remove bookmark error:", error);

        res.status(500).send({
            success: false,
            message: error.message || "Failed to remove bookmark",
        });
    }
});

app.patch("/applications/:id/status", verifyToken, verifyTutor, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Validate application ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid application ID"
            });
        }

        // Validate status
        const allowedStatus = ["Accepted", "Declined"];

        if (!allowedStatus.includes(status)) {
            return res.status(400).send({
                success: false,
                message: "Invalid application status"
            });
        }

        // Find application
        const application = await applicationsCollection.findOne({
            _id: new ObjectId(id)
        });

        if (!application) {
            return res.status(404).send({
                success: false,
                message: "Application not found"
            });
        }

        // Check tuition ownership
        const tuition = await tutions.findOne({
            _id: new ObjectId(application.tuitionId),
            tutorId: req.user._id.toString()
        });

        if (!tuition) {
            return res.status(403).send({
                success: false,
                message: "You are not allowed to update this application"
            });
        }

        // Update application status
        const result = await applicationsCollection.updateOne(
            {
                _id: new ObjectId(id),
                status: { $in: ["pending", "Awaiting Decision"] }
            },
            {
                $set: {
                    status,
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(409).send({
                success: false,
                message: "Application already reviewed"
            });
        }

        res.send({
            success: true,
            message: "Application status updated successfully",
            result
        });

    } catch (error) {
        console.error("Update application status error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to update application status"
        });
    }
});

// tuition application api
app.post('/apply-tuitions', verifyToken, verifyStudent, async (req, res) => {
    try {
        const { tuitionId } = req.body;

        // Validate tuition ID
        if (!tuitionId || !ObjectId.isValid(tuitionId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID",
            });
        }

        // Get student email from authenticated user
        const studentEmail = req.user.email.toLowerCase();

        // Find tuition
        const tuition = await tutions.findOne({
            _id: new ObjectId(tuitionId),
        });

        if (!tuition) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found",
            });
        }

        const tutorEmail = tuition.tutorEmail?.toLowerCase();

        // Prevent self application
        if (tutorEmail === studentEmail) {
            return res.status(400).send({
                success: false,
                message: "You cannot apply for your own tuition",
            });
        }

        // Check duplicate application
        const existingApplication = await applicationsCollection.findOne({
            tuitionId,
            studentEmail,
        });

        if (existingApplication) {
            return res.status(409).send({
                success: false,
                alreadyApplied: true,
                message: "You have already applied for this tuition",
            });
        }

        const application = {
            tuitionId,
            tutorEmail: tuition.tutorEmail,
            studentEmail,
            studentName: req.user.name,
            phone: req.body.phone,
            preferredSchedule: req.body.preferredSchedule,
            learningNote: req.body.learningNote,
            tuitionTitle: tuition.title,
            classLavel: tuition.classLevel,
            status: "pending",
            appliedDate: new Date(),
        };

        const result = await applicationsCollection.insertOne(application);

        return res.status(201).send({
            success: true,
            message: "Application submitted successfully",
            insertedId: result.insertedId,
        });

    } catch (error) {
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(409).send({
                success: false,
                alreadyApplied: true,
                message: "You have already applied for this tuition",
            });
        }

        console.error("Apply tuition error:", error);

        return res.status(500).send({
            success: false,
            message: "Failed to submit application",
        });
    }
});


app.get('/all-tuitions', async (req, res) => {
    const result = await tutions.find().toArray();
    res.send(result);
});

app.patch("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;

        // Validate tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID"
            });
        }

        // Find tuition
        const tuition = await tutions.findOne({
            _id: new ObjectId(id)
        });

        if (!tuition) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        // Check ownership
        if (tuition.tutorId?.toString() !== req.user._id.toString()) {
            return res.status(403).send({
                success: false,
                message: "You are not authorized to update this tuition"
            });
        }

        // Allowed fields
        const allowedFields = [
            "title",
            "subject",
            "classLevel",
            "mode",
            "location",
            "monthlyFee",
            "daysPerWeek",
            "description",
            "bannerImage"
        ];

        const updateDoc = {};

        allowedFields.forEach((field) => {
            if (updatedData[field] !== undefined) {
                updateDoc[field] = updatedData[field];
            }
        });

        // Check empty update
        if (Object.keys(updateDoc).length === 0) {
            return res.status(400).send({
                success: false,
                message: "No valid fields to update"
            });
        }

        updateDoc.updatedAt = new Date();

        // Update tuition
        const result = await tutions.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateDoc }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        res.status(200).send({
            success: true,
            message: "Tuition updated successfully",
            result
        });

    } catch (error) {
        console.error("Update tuition error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to update tuition",
            error: error.message
        });
    }
});

app.delete("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid tuition ID"
            });
        }

        const tuition = await tutions.findOne({
            _id: new ObjectId(id)
        });

        if (!tuition) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        // Check ownership
        if (tuition.tutorId?.toString() !== req.user._id.toString()) {
            return res.status(403).send({
                success: false,
                message: "Forbidden"
            });
        }

        const result = await tutions.deleteOne({
            _id: new ObjectId(id)
        });

        if (result.deletedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Tuition not found"
            });
        }

        res.send({
            success: true,
            message: "Tuition deleted successfully",
            result
        });

    } catch (error) {
        console.error("Delete tuition error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to delete tuition",
            error: error.message
        });
    }
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


app.get('/tutions', verifyToken, async (req, res) => {
    try {
        const query = {};

        if (req.user.role === "admin") {
            // Admin can see all tuitions
            if (req.query.status) {
                query.approvalStatus = req.query.status;
            }

            if (req.query.tutorEmail) {
                query.tutorEmail = req.query.tutorEmail;
            }

        } else if (req.user.role === "tutor") {
            // Tutor can see only own tuitions
            query.tutorId = req.user._id.toString();

            if (req.query.status) {
                query.approvalStatus = req.query.status;
            }

        } else {
            return res.status(403).send({
                success: false,
                message: "Forbidden access"
            });
        }

        const result = await tutions
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        res.send(result);

    } catch (err) {
        console.error("Error fetching tuitions:", err);

        res.status(500).send({
            success: false,
            message: "Failed to fetch tuitions"
        });
    }
});

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

app.post('/payments/checkout-verify', verifyToken, async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).send({
                success: false,
                message: "Session ID is required"
            });
        }

        const session = await stripe.checkout.sessions.retrieve(
            sessionId,
            {
                expand: ['payment_intent', 'subscription']
            }
        );

        const {
            status,
            payment_status,
            metadata,
            payment_intent,
            amount_total,
            currency,
            subscription,
            customer
        } = session;

        if (status !== "complete" || payment_status !== "paid") {
            return res.status(400).send({
                success: false,
                message: "Payment verification failed"
            });
        }

        const userId = metadata?.userId;

        if (!userId || !ObjectId.isValid(userId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid user ID"
            });
        }

        if (userId !== req.user._id.toString()) {
            return res.status(403).send({
                success: false,
                message: "You cannot verify another user's payment"
            });
        }

        const userDoc = await user.findOne({
            _id: new ObjectId(userId)
        });

        if (!userDoc) {
            return res.status(404).send({
                success: false,
                message: "User not found"
            });
        }

        // Check if payment already exists
        const existingPayment = await paymentsCollection.findOne({
            stripeSessionId: session.id
        });

        if (existingPayment) {
            await user.updateOne(
                { _id: userDoc._id },
                {
                    $set: {
                        premium: true,
                        plan: "pro"
                    }
                }
            );

            return res.status(200).send({
                success: true,
                message: "Payment already verified",
                alreadyVerified: true,
                payment: existingPayment
            });
        }

        const userName =
            metadata?.userName || userDoc.name || "Customer";

        const userRole =
            metadata?.userRole || userDoc.role || "student";

        const planName =
            metadata?.planName ||
            (userRole === "tutor"
                ? "MentorLagbe Tutor Pro Plan"
                : "MentorLagbe Student Pro Plan");

        const paymentData = {
            userId: userDoc._id.toString(),
            email: userDoc.email,
            userEmail: userDoc.email,
            userName,
            userRole,
            role: userRole,
            planName,
            plan: "pro",
            amount: amount_total / 100,
            currency: currency || "usd",

            transactionId:
                typeof payment_intent === "string"
                    ? payment_intent
                    : payment_intent?.id || session.id,

            stripeSessionId: session.id,

            stripeCustomerId:
                typeof customer === "string"
                    ? customer
                    : customer?.id,

            stripeSubscriptionId:
                typeof subscription === "string"
                    ? subscription
                    : subscription?.id,

            paymentStatus: "paid",
            status: "paid",
            paidAt: new Date()
        };

        const result = await paymentsCollection.insertOne(paymentData);

        await user.updateOne(
            { _id: userDoc._id },
            {
                $set: {
                    premium: true,
                    plan: "pro"
                }
            }
        );

        return res.status(200).send({
            success: true,
            message: "Payment verified successfully",
            alreadyVerified: false,
            payment: {
                _id: result.insertedId,
                ...paymentData
            }
        });

    } catch (error) {
        // Handle duplicate payment insertion
        if (error.code === 11000) {
            const existingPayment = await paymentsCollection.findOne({
                stripeSessionId: req.body.sessionId
            });

            if (existingPayment) {
                return res.status(200).send({
                    success: true,
                    message: "Payment already verified",
                    alreadyVerified: true,
                    payment: existingPayment
                });
            }
        }

        console.error("Payment verification error:", error);

        return res.status(500).send({
            success: false,
            message: "Internal server error"
        });
    }
});


app.get('/payments', verifyToken, verifyAdmin, async (req, res) => {
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