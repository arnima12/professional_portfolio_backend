const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken')
const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up multer for file storage
const multer = require('multer');
const cloudinary = require('cloudinary').v2;  // Cloudinary SDK
const path = require('path');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Use Multer for in-memory storage (no local file storage)
const storage = multer.memoryStorage(); // Store files in memory

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Check file type for image or video
        if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
            return cb(new Error('Only image and video files are allowed'), false);
        }
        cb(null, true);
    },
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB file size limit
});


// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.mwroqof.mongodb.net/`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30000 });

let usersCollection;
let deletedImagesCollection;
let eventsCollection;
const connectToDB = async () => {
    try {
        await client.connect();
        const db = client.db('innova_portfolio');
        usersCollection = db.collection('users');
        deletedImagesCollection = db.collection('deletedImages');
        eventsCollection = db.collection('events');
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1); // Exit the process if the connection fails
    }
};

connectToDB().then(() => {
    app.use('/uploads', express.static(path.join(__dirname, 'upload')));

    const authenticateToken = (req, res, next) => {
        const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
        if (!token) return res.sendStatus(401);

        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    };
    app.post('/view', async (req, res) => {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const now = new Date();
        const oneWeekAgo = new Date(now);
        oneWeekAgo.setDate(now.getDate() - 7);

        try {
            const user = await usersCollection.findOne({ email });

            if (user) {
                await usersCollection.updateOne(
                    { email },
                    {
                        $push: {
                            reachHistory: {
                                date: now.toISOString(),
                                viewCount: user.viewCount + 1
                            }
                        },
                        $inc: { viewCount: 1 }
                    }
                );

                const viewsLastWeek = user.reachHistory.filter(history => {
                    return new Date(history.date) >= oneWeekAgo;
                }).length;
                const updatedUser = await usersCollection.findOne({ email });

                res.json({
                    email,
                    viewCount: updatedUser.viewCount,
                    viewsLastWeek,
                    reachHistory: updatedUser.reachHistory
                });
            } else {
                res.status(404).json({ message: 'User not found' });
            }
        } catch (error) {
            console.error('Error updating view count:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    });

    app.get('/view/:email', async (req, res) => {
        const { email } = req.params;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        try {
            const user = await usersCollection.findOne({ email });

            if (user) {
                const now = new Date();
                const oneWeekAgo = new Date(now);
                oneWeekAgo.setDate(now.getDate() - 7);

                const viewsLastWeek = user.reachHistory.filter(history => {
                    return new Date(history.date) >= oneWeekAgo;
                }).length;

                res.json({
                    email,
                    viewCount: user.viewCount,
                    viewsLastWeek,
                    reachHistory: user.reachHistory
                });
            } else {
                res.status(404).json({ message: 'User not found' });
            }
        } catch (error) {
            console.error('Error retrieving view count:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    });
    app.patch('/users/:email', upload.fields([
        { name: 'education[0][logo]', maxCount: 1 },
        { name: 'education[1][logo]', maxCount: 1 },
        { name: 'education[2][logo]', maxCount: 1 },
        { name: 'education[3][logo]', maxCount: 1 },
        { name: 'education[4][logo]', maxCount: 1 },
        { name: 'education[5][logo]', maxCount: 1 },
        { name: 'image', maxCount: 1 }
    ]), async (req, res) => {
        const userEmail = req.params.email;
        const { newExperience, removeExperienceIndex, newEducation, removeEducationIndex, name, gender, bio, dob, profession, phone, linkedin, facebook, youtube, address, education, experience } = req.body;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                console.error(`User with email ${userEmail} not found`);
                return res.status(404).send({ message: 'User not found' });
            }

            let updatedExperience = user.experience || [];
            let updatedEducation = user.education || [];

            if (newExperience) {
                updatedExperience.push(JSON.parse(newExperience));
            }

            if (removeExperienceIndex !== undefined) {
                updatedExperience = updatedExperience.filter((_, index) => index !== parseInt(removeExperienceIndex, 10));
            }

            if (newEducation) {
                updatedEducation.push(JSON.parse(newEducation));
            }

            if (removeEducationIndex !== undefined) {
                updatedEducation = updatedEducation.filter((_, index) => index !== parseInt(removeEducationIndex, 10));
            }

            let updateFields = {};

            // Upload 'image' to Cloudinary if provided
            if (req.files['image']) {
                const imageFile = req.files['image'][0];
                const uploadStream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto' }, // auto for both image/video
                    async (error, result) => {
                        if (error) {
                            console.error('Error uploading image to Cloudinary:', error);
                            return res.status(500).send({ message: 'Error uploading image to Cloudinary', error: error.message });
                        }

                        updateFields.image = result.secure_url; // Cloudinary URL for image

                        // Now handle education logos
                        let fieldEducation = Array.isArray(education) ? education : JSON.parse(education);

                        fieldEducation = fieldEducation.map((edu, index) => {
                            if (req.files[`education[${index}][logo]`]) {
                                const logoFile = req.files[`education[${index}][logo]`][0];
                                const logoUploadStream = cloudinary.uploader.upload_stream(
                                    { resource_type: 'auto' },
                                    (logoError, logoResult) => {
                                        if (logoError) {
                                            console.error('Error uploading logo to Cloudinary:', logoError);
                                            return res.status(500).send({ message: 'Error uploading logo to Cloudinary', error: logoError.message });
                                        }

                                        edu.logo = logoResult.secure_url; // Cloudinary URL for logo
                                        return edu;
                                    }
                                );
                                logoFile.stream.pipe(logoUploadStream);
                            } else {
                                if (user.education && user.education[index] && user.education[index].logo) {
                                    edu.logo = user.education[index].logo;
                                }
                            }
                            return edu;
                        });

                        const fieldExperience = Array.isArray(experience) ? experience : JSON.parse(experience);

                        const updateObject = {
                            $set: {
                                name,
                                bio,
                                gender,
                                dob,
                                phone,
                                profession,
                                email: userEmail,
                                linkedin,
                                facebook,
                                youtube,
                                address,
                                experience: fieldExperience,
                                education: fieldEducation,
                                ...updateFields
                            }
                        };

                        const resultUpdate = await usersCollection.updateOne({ email: userEmail }, updateObject);

                        if (resultUpdate.modifiedCount > 0) {
                            res.status(200).send({ message: 'User updated successfully' });
                        } else {
                            res.status(200).send({ message: 'No changes made to the user' });
                        }
                    }
                );
                imageFile.stream.pipe(uploadStream);
            } else {
                // If no image provided, update other fields
                let fieldEducation = Array.isArray(education) ? education : JSON.parse(education);
                fieldEducation = fieldEducation.map((edu, index) => {
                    if (req.files[`education[${index}][logo]`]) {
                        const newLogoFile = req.files[`education[${index}][logo]`][0];
                        edu.logo = `http://localhost:8000/uploads/${newLogoFile.filename}`;
                    } else {
                        if (user.education && user.education[index] && user.education[index].logo) {
                            edu.logo = user.education[index].logo;
                        }
                    }
                    return edu;
                });

                const fieldExperience = Array.isArray(experience) ? experience : JSON.parse(experience);

                const updateObject = {
                    $set: {
                        name,
                        bio,
                        gender,
                        dob,
                        phone,
                        profession,
                        email: userEmail,
                        linkedin,
                        facebook,
                        youtube,
                        address,
                        experience: fieldExperience,
                        education: fieldEducation,
                        ...updateFields
                    }
                };

                const resultUpdate = await usersCollection.updateOne({ email: userEmail }, updateObject);

                if (resultUpdate.modifiedCount > 0) {
                    res.status(200).send({ message: 'User updated successfully' });
                } else {
                    res.status(200).send({ message: 'No changes made to the user' });
                }
            }
        } catch (error) {
            console.error('Error updating user:', error);
            res.status(500).send({ message: 'Error updating user', error: error.message });
        }
    });
    app.patch('/users/:email/remove-education', async (req, res) => {
        const userEmail = req.params.email;
        const { removeEducationIndex } = req.body;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const index = parseInt(removeEducationIndex, 10);
            if (isNaN(index) || index < 0 || index >= (user.education ? user.education.length : 0)) {
                return res.status(400).send({ message: 'Invalid education index' });
            }

            const updatedEducation = user.education.filter((_, i) => i !== index);

            const result = await usersCollection.updateOne(
                { email: userEmail },
                { $set: { education: updatedEducation } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Education entry removed successfully' });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error removing education:', error);
            res.status(500).send({ message: 'Error removing education', error: error.message });
        }
    });
    app.patch('/users/:email/remove-experience', async (req, res) => {
        const userEmail = req.params.email;
        const { removeExperienceIndex } = req.body;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const index = parseInt(removeExperienceIndex, 10);
            if (isNaN(index) || index < 0 || index >= (user.experience ? user.experience.length : 0)) {
                return res.status(400).send({ message: 'Invalid experience index' });
            }

            const updatedExperience = user.experience.filter((_, i) => i !== index);

            const result = await usersCollection.updateOne(
                { email: userEmail },
                { $set: { experience: updatedExperience } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Experience entry removed successfully' });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error removing experience:', error);
            res.status(500).send({ message: 'Error removing experience', error: error.message });
        }
    });
    app.patch('/users/:email/update-logo', upload.single('logo'), async (req, res) => {
        const userEmail = req.params.email;
        const logoFile = req.file; // File from the upload

        if (!logoFile) {
            return res.status(400).send({ message: 'No logo file uploaded' });
        }

        try {
            // Upload file to Cloudinary (using in-memory buffer)
            const result = await cloudinary.uploader.upload_stream(
                { resource_type: 'auto' }, // auto for image and video
                async (error, result) => {
                    if (error) {
                        return res.status(500).send({ message: 'Error uploading to Cloudinary', error: error.message });
                    }

                    const logoUrl = result.secure_url; // Get the URL of the uploaded image

                    // Update user in MongoDB
                    const user = await usersCollection.findOne({ email: userEmail });
                    if (!user) {
                        return res.status(404).send({ message: 'User not found' });
                    }

                    const update = { $set: { logo: logoUrl } };
                    const updateResult = await usersCollection.updateOne({ email: userEmail }, update);

                    if (updateResult.modifiedCount > 0) {
                        res.status(200).send({ message: 'Logo updated successfully', url: logoUrl });
                    } else {
                        res.status(200).send({ message: 'No changes made to the user' });
                    }
                }
            );

            // Pipe the file buffer to Cloudinary upload stream
            logoFile.stream.pipe(result);

        } catch (error) {
            console.error('Error updating logo:', error);
            res.status(500).send({ message: 'Error updating logo', error: error.message });
        }
    });

    app.patch('/users/:email/gallery', upload.array('gallery', 10), async (req, res) => {
        console.log('Gallery upload request received');
        const userEmail = req.params.email;
        const files = req.files || [];
        const data = req.body;
        console.log("Files:", files);
        console.log("Data:", data);

        const titles = Array.isArray(data.titles) ? data.titles : [];
        console.log("titles", titles);

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            // Upload images to Cloudinary and get URLs
            const uploadPromises = files.map(file => {
                return new Promise((resolve, reject) => {
                    cloudinary.uploader.upload(file.path, { folder: 'user_gallery' }, (error, result) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(result.secure_url);
                        }
                    });
                });
            });

            // Resolve all upload promises to get the Cloudinary URLs
            const galleryUrls = await Promise.all(uploadPromises);
            console.log("galleryUrls", galleryUrls);

            // Ensure titles match the number of uploaded images
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];

            // Combine URLs with titles
            const galleryWithTitles = galleryUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index]
            }));

            // Update the user's gallery
            const updateObject = {
                $push: { gallery: { $each: galleryWithTitles } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);
            console.log(result);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Gallery updated successfully', gallery: galleryWithTitles });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }

        } catch (error) {
            console.error('Error updating gallery:', error);
            res.status(500).send({ message: 'Error updating gallery', error: error.message });
        }
    });

    app.delete('/users/:email/permanent-delete', async (req, res) => {
        const userEmail = req.params.email;
        const { category, title } = req.query;


        try {
            const result = await usersCollection.updateOne(
                { email: userEmail },
                { $pull: { [category]: title } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Image permanently deleted successfully' });
            } else {
                res.status(404).send({ message: 'User or image not found' });
            }
        } catch (error) {
            console.error('Error permanently deleting image:', error);
            res.status(500).send({ message: 'Error permanently deleting image', error: error.message });
        }
    });

    app.get('/users/:email/gallery', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            res.status(200).json({ gallery: user.gallery || [] });
        } catch (error) {
            console.error('Error fetching gallery:', error);
            res.status(500).send({ message: 'Error fetching gallery', error: error.message });
        }
    });
    app.patch('/users/:email/video', upload.array('videos', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;
        const titles = Array.isArray(data.titles) ? data.titles : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            // Upload videos to Cloudinary and get the URLs
            const videoUrls = [];
            for (const file of files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    resource_type: 'video', // Specify that it's a video
                    folder: 'user_videos',  // Optional: store videos in a specific folder
                    public_id: `video_${Date.now()}`, // Optional: make unique filenames
                });
                videoUrls.push(result.secure_url); // Add the Cloudinary URL of the uploaded video
            }

            // Ensure titles array has enough titles for all videos
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];

            // Combine the video URLs with titles
            const videoWithTitles = videoUrls.map((url, index) => ({
                video: url,
                title: paddedTitles[index]
            }));

            // Update the user's video field in the database
            const updateObject = {
                $push: { videos: { $each: videoWithTitles } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Videos updated successfully', videos: videoWithTitles });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating videos:', error);
            res.status(500).send({ message: 'Error updating videos', error: error.message });
        }
    });

    app.get('/users/:email/video', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            res.status(200).json({ videos: user.videos || [] });
        } catch (error) {
            res.status(500).send({ message: 'Error fetching videos', error: error.message });
        }
    });
    app.patch('/users/:email/blog', upload.array('blog', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;

        const titles = Array.isArray(data.titles) ? data.titles : [];
        const descriptions = Array.isArray(data.desc) ? data.desc : [];
        const submissionDate = Array.isArray(data.date) ? data.date : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            // Upload images to Cloudinary and get URLs
            const blogUrls = [];
            for (const file of files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_blog_images', // Optional: specify a folder
                    public_id: `blog_image_${Date.now()}`, // Optional: make filenames unique
                });
                blogUrls.push(result.secure_url); // Store the Cloudinary URL
            }

            // Ensure titles, descriptions, and dates are padded to match the number of images
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];
            const paddedDesc = [...descriptions, ...Array(files.length - descriptions.length).fill('No description')];
            const paddedDates = [...submissionDate, ...Array(files.length - submissionDate.length).fill(new Date())];

            // Combine URLs, titles, descriptions, and dates into an array
            const blogWithDetails = blogUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index],
                desc: paddedDesc[index],
                date: paddedDates[index],
            }));

            // Update the user's blog field in the database
            const updateObject = {
                $push: { blog: { $each: blogWithDetails } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Blog updated successfully', blog: blogWithDetails });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating blog:', error);
            res.status(500).send({ message: 'Error updating blog', error: error.message });
        }
    });

    app.get('/users/:email/blog', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            res.status(200).json({ blog: user.blog || [] });
        } catch (error) {
            console.error('Error fetching gallery:', error);
            res.status(500).send({ message: 'Error fetching gallery', error: error.message });
        }
    });
    app.patch('/users/:email/news', upload.array('news', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;

        const titles = Array.isArray(data.titles) ? data.titles : [];
        const descriptions = Array.isArray(data.desc) ? data.desc : [];
        const submissionDate = Array.isArray(data.date) ? data.date : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            // Upload images to Cloudinary
            const newsUrls = [];
            for (const file of files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_news_images', // Optional: specify a folder
                    public_id: `news_image_${Date.now()}`, // Optional: make filenames unique
                });
                newsUrls.push(result.secure_url); // Store the Cloudinary URL
            }

            // Ensure titles, descriptions, and dates are padded to match the number of images
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];
            const paddedDesc = [...descriptions, ...Array(files.length - descriptions.length).fill('No description')];
            const paddedDates = [...submissionDate, ...Array(files.length - submissionDate.length).fill(new Date())];

            // Combine URLs, titles, descriptions, and dates into an array
            const newsWithDetails = newsUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index],
                desc: paddedDesc[index],
                date: paddedDates[index],
            }));

            // Update the user's news field in the database
            const updateObject = {
                $push: { news: { $each: newsWithDetails } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'News updated successfully', news: newsWithDetails });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating news:', error);
            res.status(500).send({ message: 'Error updating news', error: error.message });
        }
    });

    app.patch('/users/:email/updatedDraft', upload.array('files'), async (req, res) => {
        const { email } = req.params;
        const { draftData } = req.body;
        console.log("draftData", draftData);
        const files = req.files;

        try {
            const parsedDraftData = JSON.parse(draftData);
            const activeSection = parsedDraftData.activeSection;

            if (!files || files.length === 0) {
                return res.status(400).json({ message: 'No files uploaded' });
            }

            // Upload files to Cloudinary and get URLs
            const filesData = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_drafts_files', // Optional: specify a folder in Cloudinary
                    public_id: `draft_file_${Date.now()}`, // Optional: make filenames unique
                });

                const fileData = {
                    title: (parsedDraftData?.[activeSection]?.files[i]?.title) || `File ${i + 1}`,
                    url: result.secure_url, // Use Cloudinary URL
                    activeSection: activeSection,
                };
                filesData.push(fileData);
            }

            const newDraft = {
                email,
                draftData: {
                    files: filesData,
                },
                createdAt: new Date(),
            };

            const draftsCollection = client.db('innova_portfolio').collection('drafts');
            await draftsCollection.insertOne(newDraft);

            res.status(201).json({ message: 'New draft saved successfully', draft: newDraft });

        } catch (error) {
            console.error('Error saving draft data:', error);
            res.status(500).json({ message: 'Error saving draft data', error: error.message });
        }
    });


    app.get('/users/:email/updatedDraft', async (req, res) => {
        const { email } = req.params;

        try {
            const draftsCollection = client.db('innova_portfolio').collection('drafts');
            const drafts = await draftsCollection.find({ email }).toArray();
            res.status(200).json(drafts);
        } catch (error) {
            console.error('Error fetching drafts:', error);
            res.status(500).json({ message: 'Error fetching drafts' });
        }
    });
    app.delete('/users/:email/delete', async (req, res) => {
        const userEmail = req.params.email;
        const { itemType, itemUrl, title } = req.body;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            let fieldToPull;
            let queryCondition;

            switch (itemType) {
                case 'image':
                    fieldToPull = 'gallery';
                    queryCondition = { image: itemUrl };
                    break;
                case 'video':
                    fieldToPull = 'videos';
                    queryCondition = { video: itemUrl };
                    break;
                case 'blog':
                    fieldToPull = 'blog';
                    queryCondition = { image: itemUrl };
                    break;
                case 'news':
                    fieldToPull = 'news';
                    queryCondition = { image: itemUrl };
                    break;
                default:
                    return res.status(400).send({ message: 'Invalid item type' });
            }

            const result = await usersCollection.updateOne(
                { email: userEmail },
                { $pull: { [fieldToPull]: queryCondition } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted successfully` });
            } else {
                res.status(404).send({ message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} not found` });
            }
        } catch (error) {
            console.error(`Error deleting ${itemType}:`, error);
            res.status(500).send({ message: `Error deleting ${itemType}`, error: error.message });
        }
    });
    app.post('/users/:email/store-deleted-item', async (req, res) => {
        const userEmail = req.params.email;
        const { itemType, item } = req.body;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            await usersCollection.updateOne(
                { email: userEmail },
                { $push: { deletedItems: item } }
            );

            res.status(200).send({ message: 'Deleted item stored successfully' });
        } catch (error) {
            console.error('Error storing deleted item:', error);
            res.status(500).send({ message: 'Error storing deleted item', error: error.message });
        }
    });
    app.get('/users/:email/store-deleted-item', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const deletedItems = user.deletedItems || [];

            res.status(200).send({ deletedItems });
        } catch (error) {
            console.error('Error retrieving deleted items:', error);
            res.status(500).send({ message: 'Error retrieving deleted items', error: error.message });
        }
    });
    app.delete('/users/:email/delete-item', async (req, res) => {
        const { email } = req.params;
        const { image, video, title } = req.body;

        try {
            const result = await usersCollection.updateOne(
                { email: email },
                { $pull: { deletedItems: { $or: [{ image }, { video }, { title }] } } }
            );

            if (result.modifiedCount === 0) {
                return res.status(404).send({ message: 'Item not found or already deleted' });
            }

            res.status(200).send({ message: 'Item deleted successfully' });
        } catch (error) {
            console.error('Error deleting item:', error);
            res.status(500).send({ message: 'Error deleting item', error: error.message });
        }
    });


    app.patch('/users/:email/notifications', async (req, res) => {
        const { senderName, senderEmail, subject, message, toEmail } = req.body;

        const userEmail = req.params.email;
        if (!senderName || !senderEmail || !subject || !message) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        console.log('Received notification:', { senderName, senderEmail, subject, message, toEmail: userEmail });

        if (!senderName || !senderEmail || !subject || !message) {
            return res.status(400).send({ message: 'All fields are required' });
        }

        try {
            const user = await usersCollection.findOne({ email: toEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const notification = {
                senderName,
                senderEmail,
                subject,
                message,
                timestamp: new Date()
            };

            const result = await usersCollection.updateOne(
                { email: toEmail },
                { $push: { notifications: notification } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Notification sent successfully', notification });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error sending notification:', error);
            res.status(500).send({ message: 'Error sending notification', error: error.message });
        }
    });
    app.get('/users/:email/notifications', async (req, res) => {
        try {
            const userEmail = req.params.email;
            const user = await usersCollection.findOne({ email: userEmail }, { projection: { notifications: 1 } });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }
            res.status(200).json({ notifications: user.notifications || [] });
        } catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).send({ message: 'Error fetching notifications', error: error.message });
        }
    });
    app.patch('/users/:email/events', async (req, res) => {
        const { email } = req.params;
        const { title, date } = req.body;

        if (!title || !date) {
            console.log('Missing fields in request body');
            return res.status(400).json({ error: 'All fields are required' }); // Bad request
        }

        try {
            const newEvent = {
                email,
                title,
                date: new Date(date),
            };

            // Update the user document by pushing the new event to the events array
            const result = await usersCollection.updateOne(
                { email }, // Match the user by email
                { $push: { events: newEvent } }
            );

            if (result.matchedCount === 0) {
                console.log('User not found');
                return res.status(404).json({ error: 'User not found' }); // User not found
            }

            if (result.modifiedCount === 0) {
                console.log('Event not added');
                return res.status(500).json({ error: 'Failed to add event' }); // Failed to update events
            }

            res.status(200).json(newEvent); // Success - Return the new event
        } catch (error) {
            console.error('Error creating event:', error);
            res.status(500).json({ error: 'Server error occurred' }); // Internal Server Error
        }
    });
    app.get('/users/:email/events', async (req, res) => {
        const { email } = req.params;

        try {
            const user = await usersCollection.findOne({ email });

            if (!user) {
                console.log('User not found');
                return res.status(404).json({ error: 'User not found' }); // User not found
            }

            // Return the user's events
            res.status(200).json(user.events); // Success - Return the user's events
        } catch (error) {
            console.error('Error fetching events:', error);
            res.status(500).json({ error: 'Server error occurred' }); // Internal Server Error
        }
    });
    app.get('/search', async (req, res) => {
        const { query } = req.query;
        try {
            // Perform a case-insensitive search
            const results = await Item.find({
                title: { $regex: query, $options: 'i' },  // 'i' for case-insensitive
            });
            res.json({ results });
        } catch (error) {
            console.error('Error fetching search results:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    });
    app.patch('/users/:email/draft/gallery', upload.array('gallery', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        console.log("files", files);
        const data = req.body;
        const titles = Array.isArray(data.titles) ? data.titles : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!files || files.length === 0) {
                return res.status(400).send({ message: 'No files uploaded' });
            }

            // Upload images to Cloudinary and get URLs
            const galleryUrls = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_gallery', // Optional: specify a folder in Cloudinary
                    public_id: `gallery_image_${Date.now()}`, // Optional: make filenames unique
                });
                galleryUrls.push(result.secure_url);
            }

            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];

            const galleryWithTitles = galleryUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index]
            }));

            const updateObject = {
                $push: { gallery: { $each: galleryWithTitles } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Gallery updated successfully', gallery: galleryWithTitles });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating gallery:', error);
            res.status(500).send({ message: 'Error updating gallery', error: error.message });
        }
    });

    app.patch('/users/:email/draft/video', upload.array('videos', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;
        const titles = Array.isArray(data.titles) ? data.titles : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!files || files.length === 0) {
                return res.status(400).send({ message: 'No files uploaded' });
            }

            // Upload videos to Cloudinary and get URLs
            const videoUrls = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const result = await cloudinary.uploader.upload(file.path, {
                    resource_type: 'video',  // Specifies that the file is a video
                    folder: 'user_videos',  // Optional: specify a folder for videos in Cloudinary
                    public_id: `video_${Date.now()}`,  // Optional: make the filename unique
                });
                videoUrls.push(result.secure_url);  // Save the URL of the uploaded video
            }

            // Pad titles if there are fewer titles than videos
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];

            const videoWithTitles = videoUrls.map((url, index) => ({
                video: url,
                title: paddedTitles[index]
            }));

            // Update user with the new video data
            const updateObject = {
                $push: { videos: { $each: videoWithTitles } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Video updated successfully', videos: videoWithTitles });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating video:', error);
            res.status(500).send({ message: 'Error updating video', error: error.message });
        }
    });

    app.patch('/users/:email/draft/blog', upload.array('blog', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;

        const titles = Array.isArray(data.titles) ? data.titles : [];
        const descriptions = Array.isArray(data.desc) ? data.desc : [];
        const submissionDate = Array.isArray(data.date) ? data.date : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!files || files.length === 0) {
                return res.status(400).send({ message: 'No files uploaded' });
            }

            // Upload each blog image to Cloudinary and get the URLs
            const blogUrls = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_blogs',  // Optional: specify a folder in Cloudinary
                    public_id: `blog_image_${Date.now()}`,  // Unique ID for each image
                });
                blogUrls.push(result.secure_url);  // Save the URL of the uploaded image
            }

            // Pad titles, descriptions, and submission dates if necessary
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];
            const paddedDesc = [...descriptions, ...Array(files.length - descriptions.length).fill('No description')];
            const paddedDates = [...submissionDate, ...Array(files.length - submissionDate.length).fill(new Date())];

            // Combine the image URLs with the title, description, and date for each blog post
            const blogWithTitlesAndDesc = blogUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index],
                desc: paddedDesc[index],
                date: paddedDates[index],
            }));

            // Update the user's blog data
            const updateObject = {
                $push: { blog: { $each: blogWithTitlesAndDesc } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'Blog updated successfully', blog: blogWithTitlesAndDesc });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating blog:', error);
            res.status(500).send({ message: 'Error updating blog', error: error.message });
        }
    });

    app.patch('/users/:email/draft/news', upload.array('news', 10), async (req, res) => {
        const userEmail = req.params.email;
        const files = req.files;
        const data = req.body;
        const titles = Array.isArray(data.titles) ? data.titles : [];
        const descriptions = Array.isArray(data.desc) ? data.desc : [];
        const submissionDate = Array.isArray(data.date) ? data.date : [];

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!files || files.length === 0) {
                return res.status(400).send({ message: 'No files uploaded' });
            }

            // Upload each news image to Cloudinary and get the URLs
            const newsUrls = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'user_news',  // Optional: specify a folder in Cloudinary
                    public_id: `news_image_${Date.now()}`,  // Unique ID for each image
                });
                newsUrls.push(result.secure_url);  // Save the URL of the uploaded image
            }

            // Pad titles, descriptions, and submission dates if necessary
            const paddedTitles = [...titles, ...Array(files.length - titles.length).fill('Untitled')];
            const paddedDesc = [...descriptions, ...Array(files.length - descriptions.length).fill('No description')];
            const paddedDates = [...submissionDate, ...Array(files.length - submissionDate.length).fill(new Date())];

            // Combine the image URLs with the title, description, and date for each news post
            const newsWithTitlesAndDesc = newsUrls.map((url, index) => ({
                image: url,
                title: paddedTitles[index],
                desc: paddedDesc[index],
                date: paddedDates[index],
            }));

            // Update the user's news data
            const updateObject = {
                $push: { news: { $each: newsWithTitlesAndDesc } }
            };

            const result = await usersCollection.updateOne({ email: userEmail }, updateObject);

            if (result.modifiedCount > 0) {
                res.status(200).send({ message: 'News updated successfully', news: newsWithTitlesAndDesc });
            } else {
                res.status(200).send({ message: 'No changes made to the user' });
            }
        } catch (error) {
            console.error('Error updating news:', error);
            res.status(500).send({ message: 'Error updating news', error: error.message });
        }
    });


    app.get('/users/:email/draft/gallery', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }
            if (!user.gallery || user.gallery.length === 0) {
                return res.status(200).send({ message: 'No gallery items found for this user', gallery: [] });
            }

            res.status(200).send({ message: 'Gallery fetched successfully', gallery: user.gallery });
        } catch (error) {
            console.error('Error fetching gallery:', error);
            res.status(500).send({ message: 'Error fetching gallery', error: error.message });
        }
    });
    app.get('/users/:email/draft/videos', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!user.videos || user.videos.length === 0) {
                return res.status(200).send({ message: 'No videos found for this user', videos: [] });
            }

            res.status(200).send({ message: 'Videos fetched successfully', videos: user.videos });
        } catch (error) {
            console.error('Error fetching videos:', error);
            res.status(500).send({ message: 'Error fetching videos', error: error.message });
        }
    });

    app.get('/users/:email/draft/blog', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!user.blog || user.blog.length === 0) {
                return res.status(200).send({ message: 'No blogs found for this user', blog: [] });
            }

            res.status(200).send({ message: 'Blog fetched successfully', blog: user.blog });
        } catch (error) {
            console.error('Error fetching blog:', error);
            res.status(500).send({ message: 'Error fetching blog', error: error.message });
        }
    });

    app.get('/users/:email/draft/news', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            if (!user.news || user.news.length === 0) {
                return res.status(200).send({ message: 'No news found for this user', news: [] });
            }

            res.status(200).send({ message: 'News fetched successfully', news: user.news });
        } catch (error) {
            console.error('Error fetching news:', error);
            res.status(500).send({ message: 'Error fetching news', error: error.message });
        }
    });

    app.get('/users/:email/draft', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const drafts = user.draft || [];

            res.status(200).send({ drafts });
        } catch (error) {
            console.error('Error fetching drafts:', error);
            res.status(500).send({ message: 'Error fetching drafts', error: error.message });
        }
    });
    app.get('/users/:email/deleted-news', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail }, { projection: { deletedNews: 1 } });

            if (user) {
                res.status(200).send(user.deletedNews || []);
            } else {
                res.status(404).send({ message: 'User not found' });
            }
        } catch (error) {
            console.error('Error fetching deleted news:', error);
            res.status(500).send({ message: 'Error fetching deleted news', error: error.message });
        }
    });
    app.get('/users/:email/news', async (req, res) => {
        const userEmail = req.params.email;

        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            res.status(200).json({ news: user.news || [] });
        } catch (error) {
            console.error('Error fetching gallery:', error);
            res.status(500).send({ message: 'Error fetching gallery', error: error.message });
        }
    });
    app.get('/users/:email', async (req, res) => {
        const userEmail = req.params.email;
        try {
            const user = await usersCollection.findOne({ email: userEmail });
            if (!user) {
                console.error(`User with email ${userEmail} not found`);
                return res.status(404).json({ message: 'User not found' });
            }

            res.status(200).json({
                name: user.name || '',
                bio: user.bio || '',
                gender: user.gender || '',
                dob: user.dob || '',
                profession: user.profession || '',
                phone: user.phone || '',
                linkedin: user.linkedin || '',
                facebook: user.facebook || '',
                youtube: user.youtube || '',
                address: user.address || '',
                experience: user.experience || [],
                education: user.education || [],
                image: user.image || null,
                logo: user.logo || "",
                gallery: user.gallery || [],
                videos: user.videos || [],
                blog: user.blog || [],
                news: user.news || [],
            });

        } catch (error) {
            console.error('Error fetching user:', error);
            res.status(500).json({ message: 'Error fetching user', error: error.message });
        }
    });
    app.get('/users/jwt', async (req, res) => {
        const email = req.query.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);

        if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
            return res.send({ accessToken: token });
        }

        res.status(403).send({ accessToken: '' });
    });
    app.post('/users', (req, res) => {
        const { name, email } = req.body;

        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }

        const newUser = { name, email };

        usersCollection.insertOne(newUser, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error saving user to the database' });
            }

            res.status(201).json(result.ops[0]);
        });
    });
    app.get('/users', async (req, res) => {
        try {
            if (!usersCollection) {
                return res.status(500).send({ message: 'Database not initialized' });
            }

            const users = await usersCollection.find({}).toArray();
            res.status(200).send(users);
        } catch (error) {
            console.error('Error retrieving users:', error);
            res.status(500).send({ message: 'Error retrieving users', error: error.message });
        }
    });




    app.listen(port, () => {
        console.log(`Innova Portfolio server running on port ${port}`);
    });
})
